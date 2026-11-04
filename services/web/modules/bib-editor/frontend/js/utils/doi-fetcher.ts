/**
 * Client-side DOI metadata fetcher.
 *
 * Strategy:
 *  1. CrossRef API (api.crossref.org) — CORS-friendly, returns JSON we convert to BibTeX fields.
 *  2. doi.org content-negotiation with Accept: application/x-bibtex — may fail on some publishers
 *     due to redirect CORS restrictions, but works for many.
 */
import { parseBibtex } from '@/features/bibtex/bibtex-parser'
import { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { BibtexFieldValue } from '@shared/bibtex/bibtex-field-value.mts'
import { normaliseDoi, isValidDoi, encodeDoiPath } from './bib-doi'

interface FetchedBibEntry {
  entry: BibtexEntry
}

// CrossRef response conversion helpers.

interface CrossRefAuthor {
  family?: string
  given?: string
  name?: string
}

export interface CrossRefMessage {
  type?: string
  title?: string[]
  author?: CrossRefAuthor[]
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
  DOI?: string
  URL?: string
  publisher?: string
}

function crossRefTypeToBibtex(crType?: string): string {
  switch (crType) {
    case 'book':
    case 'monograph':
      return 'book'
    case 'book-chapter':
      return 'inbook'
    case 'proceedings-article':
      return 'inproceedings'
    case 'proceedings':
      return 'proceedings'
    case 'thesis':
      return 'phdthesis'
    case 'report':
      return 'techreport'
    case 'dataset':
      return 'misc'
    default:
      return 'article'
  }
}

export function crossRefMessageToEntry(msg: CrossRefMessage): FetchedBibEntry {
  const type = crossRefTypeToBibtex(msg.type)
  const fields = new Map<string, BibtexFieldValue>()

  const setField = (name: string, value: string | undefined) => {
    if (value) fields.set(name, BibtexFieldValue.fromEditableString(value))
  }

  setField('title', msg.title?.[0])

  if (msg.author?.length) {
    setField(
      'author',
      msg.author
        .map(a => a.name
          ? `{${a.name}}`
          : [a.family, a.given].filter(Boolean).join(', '))
        .filter(Boolean)
        .join(' and ')
    )
  }

  const year = msg.issued?.['date-parts']?.[0]?.[0]
  if (year) setField('year', String(year))

  if (msg['container-title']?.[0]) {
    if (type === 'inbook' || type === 'inproceedings' || type === 'proceedings') {
      setField('booktitle', msg['container-title'][0])
    } else {
      setField('journal', msg['container-title'][0])
    }
  }

  setField('volume', msg.volume)
  if (msg.issue) setField('number', String(msg.issue))
  setField('pages', msg.page)
  setField('doi', msg.DOI)
  setField('url', msg.URL)
  setField('publisher', msg.publisher)

  return { entry: new BibtexEntry({ type, key: '', fields }) }
}

// Public DOI fetch API.

const DOI_REQUEST_TIMEOUT_MS = 10_000

/** Bound each provider attempt, including response-body parsing. */
async function withDoiRequestTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('doi_request_timeout'))
        }, DOI_REQUEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

/**
 * Fetch bibliographic metadata for a DOI and return it as BibTeX fields.
 * Throws an Error if the DOI is invalid or all sources fail.
 */
export async function fetchEntryFromDoi(raw: string): Promise<FetchedBibEntry> {
  const doi = normaliseDoi(raw)

  if (!isValidDoi(doi)) {
    throw new Error('invalid_doi_format')
  }

  // First try CrossRef because its JSON response is straightforward to map
  // into the BibTeX fields used by the form.
  try {
    const url = `https://api.crossref.org/works/${encodeDoiPath(doi)}`
    const message = await withDoiRequestTimeout(async signal => {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        signal,
      })
      if (!res.ok) return undefined
      const json: { message?: CrossRefMessage } = await res.json()
      return json?.message
    })
    if (message) return crossRefMessageToEntry(message)
  } catch {
    // Continue with the content-negotiation fallback below.
  }

  // Fall back to doi.org content negotiation when CrossRef cannot resolve the DOI.
  try {
    const url = `https://doi.org/${encodeDoiPath(doi)}`
    const text = await withDoiRequestTimeout(async signal => {
      const res = await fetch(url, {
        headers: { Accept: 'application/x-bibtex, text/x-bibtex;q=0.9' },
        credentials: 'omit',
        // doi.org content negotiation legitimately redirects to publishers.
        signal,
      })
      return res.ok ? res.text() : undefined
    })
    if (text?.trim().startsWith('@')) {
      const parsed = parseBibtex(text).entries[0]
      if (parsed) return { entry: parsed }
    }
  } catch {
    // Both providers failed; report one useful error to the caller.
  }

  throw new Error(
    'could_not_retrieve_doi_metadata'
  )
}
