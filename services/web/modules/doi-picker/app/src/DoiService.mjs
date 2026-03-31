import dns from 'node:dns'
import logger from '@overleaf/logger'

const DOI_REGEX = /^(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)$/i
const MAX_BODY_SIZE = 1024 * 1024 // 1MB
const FETCH_TIMEOUT_MS = 10_000

export function sanitizeDoi(raw) {
  if (!raw) return null
  const maybe = raw.replace(/^https?:\/\/(doi\.org\/)?/i, '').trim()
  if (DOI_REGEX.test(maybe)) {
    return maybe
  }
  return null
}

/**
 * Resolve the hostname and check it does not point to private/internal IPs.
 */
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

export async function fetchBibtexFromDoi(doi) {
  const DOI_BASE = (
    process.env.DOI_BASE_URL || 'https://doi.org'
  ).replace(/\/$/, '')
  const url = `${DOI_BASE}/${encodeURI(doi)}`

  await checkUrlNotPrivate(new URL(url))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept:
          'application/x-bibtex, text/x-bibtex, text/bibliography; style=bibtex',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (err) {
    throw new Error(`DOI fetch failed: ${err.message}`)
  } finally {
    clearTimeout(timeout)
  }

  // Check final URL after redirects to prevent redirect-based SSRF
  try {
    await checkUrlNotPrivate(new URL(res.url))
  } catch (err) {
    throw new Error(`SSRF check failed after redirect: ${err.message}`)
  }

  if (!res.ok) {
    throw new Error(`DOI provider responded with ${res.status}`)
  }

  const len = res.headers.get('content-length')
  if (len && Number(len) > MAX_BODY_SIZE) {
    throw new Error('Response too large')
  }

  const text = await res.text()
  if (text.length > MAX_BODY_SIZE) {
    throw new Error('Response too large')
  }

  // If the response looks like BibTeX, return it directly
  if (text.trim().startsWith('@')) {
    return text
  }

  // Try parsing JSON CSL and converting to BibTeX manually
  try {
    const csl = JSON.parse(text)
    return cslToBibtex(csl, doi)
  } catch {
    // not JSON
  }

  throw new Error('Could not obtain BibTeX from DOI provider')
}

function cslToBibtex(msg, doi) {
  const typeMap = {
    'journal-article': 'article',
    'book-chapter': 'incollection',
    'proceedings-article': 'inproceedings',
    book: 'book',
    report: 'techreport',
    thesis: 'phdthesis',
  }
  const type = typeMap[msg.type] || 'misc'
  const title = (Array.isArray(msg.title) ? msg.title[0] : msg.title) || ''
  const authors = (msg.author || [])
    .map(a => [a.family, a.given].filter(Boolean).join(', '))
    .join(' and ')
  const journal =
    (Array.isArray(msg['container-title'])
      ? msg['container-title'][0]
      : msg['container-title']) || ''
  const year =
    msg.issued?.['date-parts']?.[0]?.[0] || msg.year || ''
  const volume = msg.volume || ''
  const pages = msg.page || ''

  const keyBase = (title.split(/\s+/)[0] || 'ref').replace(/[^a-zA-Z]/g, '')
  const key = `${keyBase}${year || 'nd'}`

  const fields = []
  if (authors) fields.push(`  author = {${authors}}`)
  if (title) fields.push(`  title = {${title}}`)
  if (journal) fields.push(`  journal = {${journal}}`)
  if (year) fields.push(`  year = {${year}}`)
  if (volume) fields.push(`  volume = {${volume}}`)
  if (pages) fields.push(`  pages = {${pages}}`)
  if (doi) fields.push(`  doi = {${doi}}`)
  if (msg.URL) fields.push(`  url = {${msg.URL}}`)

  return `@${type}{${key},\n${fields.join(',\n')}\n}`
}
