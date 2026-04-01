import dns from 'node:dns'
import logger from '@overleaf/logger'

const ORCID_PUB_API = 'https://pub.orcid.org/v3.0'
const FETCH_TIMEOUT_MS = 10_000
const MAX_BODY_SIZE = 2 * 1024 * 1024 // 2 MB — works lists can be large
const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

/**
 * Validate an ORCID identifier format.
 */
export function isValidOrcid(raw) {
  return typeof raw === 'string' && ORCID_REGEX.test(raw.trim())
}

// ---------------------------------------------------------------------------
// SSRF guard (same as doi-picker)
// ---------------------------------------------------------------------------
async function checkUrlNotPrivate(url) {
  const records = await dns.promises.lookup(url.hostname, { all: true })
  for (const rec of records) {
    const addr = rec.address
    if (
      addr.startsWith('10.') ||
      addr.startsWith('127.') ||
      addr.startsWith('192.168.') ||
      addr === '::1' ||
      addr === '0.0.0.0' ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
    ) {
      throw new Error('SSRF: resolved to private address')
    }
  }
}

// ---------------------------------------------------------------------------
// Generic fetch helper with timeout + size guard
// ---------------------------------------------------------------------------
async function safeFetch(url, accept, timeoutMs = FETCH_TIMEOUT_MS) {
  await checkUrlNotPrivate(new URL(url))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: accept },
      signal: controller.signal,
      redirect: 'follow',
    })

    // Check final URL after redirects
    try {
      await checkUrlNotPrivate(new URL(res.url))
    } catch (err) {
      throw new Error(`SSRF check failed after redirect: ${err.message}`)
    }

    if (!res.ok) {
      throw new Error(`ORCID API responded with ${res.status}`)
    }

    const len = res.headers.get('content-length')
    if (len && Number(len) > MAX_BODY_SIZE) {
      throw new Error('Response too large')
    }

    const text = await res.text()
    if (text.length > MAX_BODY_SIZE) {
      throw new Error('Response too large')
    }

    return text
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const text = await safeFetch(url, 'application/json', timeoutMs)
  return JSON.parse(text)
}

// ---------------------------------------------------------------------------
// Search ORCID registry by author name
// Returns an array of { orcid, givenNames, familyNames, institutionNames }
// ---------------------------------------------------------------------------
export async function searchAuthors(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Search query required')
  }

  const q = query.trim()

  // Build a fielded search when the query has "FirstName LastName" form,
  // otherwise do a free-text search.
  const parts = q.split(/\s+/)
  let solrQ
  if (parts.length >= 2) {
    const given = encodeURIComponent(parts.slice(0, -1).join(' '))
    const family = encodeURIComponent(parts[parts.length - 1])
    solrQ = `given-names:${given}+AND+family-name:${family}`
  } else {
    solrQ = encodeURIComponent(q)
  }

  const url = `${ORCID_PUB_API}/expanded-search/?q=${solrQ}&start=0&rows=20`
  const data = await fetchJson(url)

  const results = (data['expanded-result'] || []).map(r => ({
    orcid: r['orcid-id'],
    givenNames: r['given-names'] || '',
    familyNames: r['family-names'] || '',
    institutionNames: (r['institution-name'] || []),
  }))

  return results
}

// ---------------------------------------------------------------------------
// Fetch the list of works (publications) for a given ORCID
// Returns simplified work summaries with title, year, DOI, type, putCode
// ---------------------------------------------------------------------------
export async function fetchWorks(orcid) {
  if (!isValidOrcid(orcid)) {
    throw new Error('Invalid ORCID identifier')
  }

  const url = `${ORCID_PUB_API}/${encodeURIComponent(orcid.trim())}/works`
  const data = await fetchJson(url)

  const works = []
  for (const group of data.group || []) {
    const summaries = group['work-summary'] || []
    if (summaries.length === 0) continue

    // Take the first (preferred) summary in each group
    const s = summaries[0]
    const title =
      s.title?.title?.value || ''
    const year =
      s['publication-date']?.year?.value || ''
    const type = s.type || ''
    const putCode = s['put-code']

    // Extract external identifiers (DOI, etc.)
    let doi = null
    const extIds = s['external-ids']?.['external-id'] || []
    for (const eid of extIds) {
      if (
        eid['external-id-type'] === 'doi' &&
        eid['external-id-value']
      ) {
        doi = eid['external-id-value']
        break
      }
    }

    works.push({ title, year, type, doi, putCode })
  }

  // Sort by year descending
  works.sort((a, b) => {
    const ya = parseInt(a.year, 10) || 0
    const yb = parseInt(b.year, 10) || 0
    return yb - ya
  })

  return works
}

// ---------------------------------------------------------------------------
// Fetch BibTeX for a specific work from ORCID.
//
// Strategy:
//  1. Fetch the full work record as JSON
//  2. If the record contains a citation of type "bibtex", use it directly
//  3. Otherwise, if there is a DOI, resolve it via doi.org content negotiation
//  4. Otherwise, construct a minimal BibTeX entry from the ORCID metadata
// ---------------------------------------------------------------------------
export async function fetchBibtexFromOrcid(orcid, putCode) {
  if (!isValidOrcid(orcid)) {
    throw new Error('Invalid ORCID identifier')
  }
  if (!putCode || !Number.isFinite(Number(putCode))) {
    throw new Error('Invalid put-code')
  }

  const url = `${ORCID_PUB_API}/${encodeURIComponent(orcid.trim())}/work/${encodeURIComponent(String(putCode))}`
  const data = await fetchJson(url)

  // --- 1. Try embedded BibTeX citation ---
  const citation = data.citation
  if (
    citation &&
    citation['citation-type'] === 'bibtex' &&
    citation['citation-value'] &&
    citation['citation-value'].trim().startsWith('@')
  ) {
    return citation['citation-value'].trim()
  }

  // --- 2. Try DOI-based fetch ---
  const extIds = data['external-ids']?.['external-id'] || []
  let doi = null
  for (const eid of extIds) {
    if (eid['external-id-type'] === 'doi' && eid['external-id-value']) {
      doi = eid['external-id-value']
      break
    }
  }

  if (doi) {
    try {
      const doiBibtex = await fetchBibtexFromDoiUrl(doi)
      if (doiBibtex) return doiBibtex
    } catch (err) {
      logger.warn({ err, doi, orcid, putCode }, 'DOI BibTeX fetch failed, falling back to metadata')
    }
  }

  // --- 3. Construct minimal BibTeX from ORCID metadata ---
  return buildBibtexFromOrcidWork(data, doi)
}

// ---------------------------------------------------------------------------
// Fetch BibTeX from doi.org using content negotiation (same as doi-picker)
// ---------------------------------------------------------------------------
const DOI_BASE = 'https://doi.org'

async function fetchBibtexFromDoiUrl(doi) {
  const url = `${DOI_BASE}/${encodeURI(doi)}`
  const text = await safeFetch(
    url,
    'application/x-bibtex, text/x-bibtex, text/bibliography; style=bibtex'
  )
  if (text && text.trim().startsWith('@')) {
    return text.trim()
  }
  return null
}

// ---------------------------------------------------------------------------
// Build a minimal BibTeX entry from the work metadata returned by ORCID
// ---------------------------------------------------------------------------
function buildBibtexFromOrcidWork(work, doi) {
  const title = work.title?.title?.value || 'Untitled'
  const year = work['publication-date']?.year?.value || ''
  const journal = work['journal-title']?.value || ''
  const type = work.type || 'misc'

  // Extract author names from contributors
  const contributors = work.contributors?.contributor || []
  const authors = contributors
    .map(c => c['credit-name']?.value)
    .filter(Boolean)
    .join(' and ')

  // Map ORCID work types to BibTeX entry types
  const typeMap = {
    'journal-article': 'article',
    'conference-paper': 'inproceedings',
    'book': 'book',
    'book-chapter': 'incollection',
    'dissertation': 'phdthesis',
    'report': 'techreport',
    'edited-book': 'book',
  }
  const bibType = typeMap[type] || 'misc'

  // Build a citation key from first author surname + year
  const firstAuthor = contributors[0]?.['credit-name']?.value || 'unknown'
  const surname = firstAuthor.split(/\s+/).pop().replace(/[^a-zA-Z]/g, '')
  const key = `${surname}${year || 'nd'}`.toLowerCase()

  let entry = `@${bibType}{${key},\n`
  if (authors) entry += `  author = {${authors}},\n`
  entry += `  title = {${title}},\n`
  if (year) entry += `  year = {${year}},\n`
  if (journal) entry += `  journal = {${journal}},\n`
  if (doi) entry += `  doi = {${doi}},\n`
  entry += `}\n`

  return entry
}
