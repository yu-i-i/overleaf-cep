/** ORCID and Crossref data types, parsing and HTTP access for the BibTeX editor. */
import { fetchJSON, ProviderHttpError, ProviderResponseError } from './provider-fetch'
import { encodeDoiPath } from '../utils/bib-doi'

export type AuthorResult = {
  orcid: string
  givenNames: string
  familyNames: string
  institutionNames: string[]
}

export type WorkVariant = {
  title: string
  year: string
  type: string
  putCode: number
  externalIds?: NonNullable<OrcidWork['external-ids']>['external-id']
  preferredExternalIds?: NonNullable<OrcidWork['external-ids']>['external-id']
  sourceName?: string
  journalTitle?: string
}

export type Work = WorkVariant & { variants?: WorkVariant[] }

export type OrcidWork = {
  url?: { value?: string }
  type?: string
  source?: { 'source-name'?: { value?: string } }
  title?: { title?: { value?: string } }
  'publication-date'?: { year?: { value?: string } }
  'journal-title'?: { value?: string }
  contributors?: {
    contributor?: Array<{
      'credit-name'?: { value?: string }
      'contributor-attributes'?: { 'contributor-role'?: string }
    }>
  }
  'external-ids'?: {
    'external-id'?: Array<{
      'external-id-type'?: string
      'external-id-value'?: string
      'external-id-url'?: { value?: string }
    }>
  }
}

// Structural Crossref response used by the host editor's existing converter.
export type CrossRefMessage = {
  type?: string
  title?: string[]
  author?: Array<{ family?: string; given?: string; name?: string }>
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
  DOI?: string
  URL?: string
  publisher?: string
}
export type DoiMetadata = { crossref: CrossRefMessage }

export type OrcidImportItem = (
  | { bibtex: string; work?: OrcidWork }
  | { work: OrcidWork }
) & { doi?: DoiMetadata }

// Reject malformed nested ORCID data at the provider boundary. A broken work is
// skipped independently; a valid embedded BibTeX citation can still be used.
function isUsableWork(value: unknown): value is OrcidWork {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const work = value as OrcidWork
  const text = (value: unknown) => value == null || typeof value === 'string'
  const named = (value: unknown): value is { value?: string } =>
    value == null || (!!value && typeof value === 'object' && !Array.isArray(value) &&
      text((value as { value?: unknown }).value))
  const ids = work['external-ids']?.['external-id']
  const people = work.contributors?.contributor
  return named(work.title?.title) && named(work['publication-date']?.year) &&
    named(work['journal-title']) &&
    (ids == null || (Array.isArray(ids) && ids.every(id => id && typeof id === 'object' &&
      text(id['external-id-type']) && text(id['external-id-value'])))) &&
    (people == null || (Array.isArray(people) && people.every(person => person && typeof person === 'object' &&
      named(person['credit-name']) &&
      (person['contributor-attributes'] == null ||
        text(person['contributor-attributes']['contributor-role'])))))
}

export function parseImportItem(data: unknown): OrcidImportItem | null {
  if (!data || typeof data !== 'object') return null
  const result = data as { bibtex?: unknown; work?: unknown }
  const work = isUsableWork(result.work) ? result.work : null
  if (typeof result.bibtex === 'string' && result.bibtex.trim()) {
    return {
      bibtex: result.bibtex,
      ...(work ? { work } : {}),
    }
  }
  return work ? { work } : null
}

export type ImportResult = {
  imported: number
  enriched: number
  unusableIndices: number[]
  skippedIndices: number[]
}

const ORCID_FORMAT = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

export function isValidOrcid(orcid: string): boolean {
  if (!ORCID_FORMAT.test(orcid)) return false
  const digits = orcid.replaceAll('-', '')
  let total = 0
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2
  const check = (12 - (total % 11)) % 11
  return digits[15] === (check === 10 ? 'X' : String(check))
}

const ORCID_PUBLIC_API = 'https://pub.orcid.org/v3.0'
const CROSSREF_API = 'https://api.crossref.org/works'
const ORCID_MAX_BATCH = 100
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/
const SOLR_SPECIAL = /([+\-&|!(){}\[\]^"~*?:\\/])/g

function publicOrcid(orcid: string): string {
  if (!isValidOrcid(orcid)) throw new Error('Invalid ORCID identifier')
  return `${ORCID_PUBLIC_API}/${orcid}`
}

function validCodes(codes: number[]) {
  if (!codes.length || codes.length > ORCID_MAX_BATCH ||
      codes.some(code => !Number.isSafeInteger(code) || code < 1) ||
      new Set(codes).size !== codes.length) throw new Error('Invalid ORCID put-codes')
}

function formatWork(work: OrcidWork & { citation?: { 'citation-type'?: string; 'citation-value'?: string } }): OrcidImportItem {
  const citation = work.citation
  if (citation?.['citation-type'] === 'bibtex' &&
      typeof citation['citation-value'] === 'string' &&
      citation['citation-value'].trim().startsWith('@')) {
    return { bibtex: citation['citation-value'].trim(), work }
  }
  return { work }
}

/** ORCID is an external API: skip malformed summaries without discarding other works. */
export function normalizeWorks(response: unknown): Work[] {
  const groups = (response as { group?: unknown } | null)?.group
  if (!Array.isArray(groups)) throw new ProviderResponseError('Invalid ORCID works response')
  const works: Work[] = []
  const string = (value: unknown) => typeof value === 'string' ? value : ''
  const read = (value: unknown, ...keys: string[]): string => {
    let current = value
    for (const key of keys) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return ''
      current = (current as Record<string, unknown>)[key]
    }
    return string(current)
  }
  type ExternalId = NonNullable<NonNullable<OrcidWork['external-ids']>['external-id']>[number]
  const ids = (value: unknown): ExternalId[] => {
    const raw = (value as { 'external-ids'?: { 'external-id'?: unknown } } | null)?.['external-ids']?.['external-id']
    return Array.isArray(raw) ? raw.filter((id): id is ExternalId =>
      !!id && typeof id === 'object' && !Array.isArray(id) &&
      typeof id['external-id-type'] === 'string' && typeof id['external-id-value'] === 'string'
    ) : []
  }
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue
    const raw = (group as { 'work-summary'?: unknown })['work-summary']
    if (!Array.isArray(raw)) continue
    const summaries = raw.filter((item): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && !Array.isArray(item) &&
      Number.isSafeInteger(item['put-code']) && Number(item['put-code']) > 0
    )
    if (!summaries.length) continue
    const displayIndex = (item: Record<string, unknown>) => {
      const value = item['display-index']
      return value == null || value === '' || !Number.isFinite(Number(value))
        ? -Infinity : Number(value)
    }
    const ranked = summaries.sort((a, b) => displayIndex(b) - displayIndex(a))
    const externalIds = [...ids(group), ...ranked.flatMap(ids)]
    const source = (item: Record<string, unknown>): WorkVariant => ({
      putCode: item['put-code'] as number,
      title: read(item, 'title', 'title', 'value'),
      year: read(item, 'publication-date', 'year', 'value'),
      type: read(item, 'type'),
      sourceName: read(item, 'source', 'source-name', 'value'),
      journalTitle: read(item, 'journal-title', 'value'),
      externalIds,
      preferredExternalIds: ids(item),
    })
    const candidates = ranked.map(source)
    const score = (item: WorkVariant) => Number(!!item.title.trim()) * 2 +
      Number(/^\d{4}$/.test(item.year)) * 2 +
      Number(!!item.journalTitle?.trim()) +
      Number(item.preferredExternalIds?.some(id => id['external-id-type']?.toLowerCase() === 'doi')) * 2
    // Respect the highest display-index when it has usable summary data.
    // Otherwise use the richest summary; full contributors are checked on import.
    let selected = candidates[0]
    if (score(selected) < 6) {
      for (const candidate of candidates.slice(1)) {
        if (score(candidate) > score(selected)) selected = candidate
      }
    }
    works.push({ ...selected, variants: candidates.filter(item => item.putCode !== selected.putCode) })
  }
  return works.sort((a, b) => (Number.parseInt(b.year, 10) || 0) - (Number.parseInt(a.year, 10) || 0))
}

/** Consider only structurally usable Crossref fields. */
function usefulCrossref(message: CrossRefMessage) {
  return (Array.isArray(message.author) && message.author.some(person =>
    !!person && typeof person === 'object' &&
    ((typeof person.family === 'string' && !!person.family.trim()) ||
     (typeof person.name === 'string' && !!person.name.trim())))) ||
    (Array.isArray(message.issued?.['date-parts']) &&
      Number.isInteger(message.issued['date-parts']?.[0]?.[0])) ||
    (Array.isArray(message.title) && message.title.some(title => typeof title === 'string' && !!title.trim())) ||
    (Array.isArray(message['container-title']) && message['container-title'].some(title => typeof title === 'string' && !!title.trim())) ||
    (typeof message.publisher === 'string' && !!message.publisher.trim()) ||
    (typeof message.volume === 'string' && !!message.volume.trim()) ||
    (typeof message.page === 'string' && !!message.page.trim())
}

/** Normalize before deduplicating and matching exact Crossref DOI identities. */
function doiValue(doi: string): string | null {
  const trimmed = doi.trim()
  const urlPrefix = /^https?:\/\/(?:dx\.)?doi\.org\//i
  let value = trimmed.replace(urlPrefix, '').replace(/^doi:/i, '')
  if (urlPrefix.test(trimmed)) {
    try {
      // DOI URLs escape path punctuation; a bare DOI may contain literal percent signs.
      value = decodeURIComponent(value)
    } catch {
      return null
    }
  }
  return DOI_PATTERN.test(value) && value.length <= 300 ? value : null
}

export function normalizedDoi(doi: string): string | null {
  return doiValue(doi)?.toLowerCase() ?? null
}

/** Shared identity and usability check for both Crossref endpoints. */
function crossrefMetadata(value: unknown, requestedDoi: string): DoiMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const message = value as CrossRefMessage
  return typeof message.DOI === 'string' && normalizedDoi(message.DOI) === requestedDoi &&
    usefulCrossref(message) ? { crossref: message } : null
}

/** Batch ordinary DOIs via Crossref filters. DOIs containing commas need an
 * individually encoded URL because the filter syntax uses commas as separators.
 * Retain completed chunks and continue past non-rate-limit provider failures.
 */
export async function fetchDoiMetadataBatch(
  dois: string[], signal: AbortSignal
): Promise<{ entries: Map<string, DoiMetadata>; attempted: Set<string>; rateLimited: Set<string>; error?: unknown }> {
  if (!dois.length || dois.length > 150) throw new Error('Invalid DOI batch')
  const unique = [...new Set(dois.map(normalizedDoi).filter((doi): doi is string =>
    !!doi && !doi.startsWith('10.48550/arxiv.')
  ))]
  const entries = new Map<string, DoiMetadata>()
  const attempted = new Set<string>()
  const rateLimited = new Set<string>()
  const chunks: string[][] = []
  let current: string[] = []
  for (const doi of unique) {
    if (doi.includes(',')) {
      if (current.length) chunks.push(current)
      chunks.push([doi])
      current = []
      continue
    }
    if (current.length && (current.length === 10 || [...current, doi].join(',').length > 1400)) {
      chunks.push(current)
      current = []
    }
    current.push(doi)
  }
  if (current.length) chunks.push(current)

  let error: unknown
  for (const batch of chunks) {
    if (signal.aborted) break
    batch.forEach(doi => attempted.add(doi))
    const commaDoi = batch.length === 1 && batch[0].includes(',')
    try {
      if (commaDoi) {
        const doiPath = encodeDoiPath(batch[0])
        const result = await fetchJSON(`${CROSSREF_API}/${doiPath}`, signal) as {
          message?: unknown
        }
        const metadata = crossrefMetadata(result?.message, batch[0])
        if (metadata) entries.set(batch[0], metadata)
      } else {
        const params = new URLSearchParams({
          filter: batch.map(doi => `doi:${doi}`).join(','),
          rows: String(batch.length),
          select: 'DOI,type,title,author,issued,container-title,volume,issue,page,URL,publisher',
        })
        const result = await fetchJSON(`${CROSSREF_API}?${params}`, signal, 4 * 1024 * 1024) as {
          message?: { items?: unknown[] }
        }
        if (!Array.isArray(result?.message?.items)) throw new ProviderResponseError('Invalid Crossref batch')
        for (const value of result.message.items) {
          const doi = (value && typeof value === 'object' && 'DOI' in value &&
            typeof value.DOI === 'string') ? normalizedDoi(value.DOI) : null
          if (!doi || !batch.includes(doi)) continue
          const metadata = crossrefMetadata(value, doi)
          if (metadata) entries.set(doi, metadata)
        }
      }
    } catch (failure) {
      // Missing or temporarily unavailable metadata must not block other chunks.
      if (commaDoi && failure instanceof ProviderHttpError && failure.status === 404) continue
      if (isRateLimit(failure)) {
        error = failure
        batch.forEach(doi => rateLimited.add(doi))
        break
      }
      // Cancellation or forbidden access is not a transient DOI-specific failure.
      if (signal.aborted || (failure instanceof Error && failure.name === 'AbortError') ||
          (failure instanceof ProviderHttpError && (failure.status === 401 || failure.status === 403))) {
        error = failure
        break
      }
      error ??= failure
    }
  }
  return { entries, attempted, rateLimited, ...(error ? { error } : {}) }
}

/** Respect the selected ORCID source before considering grouped versions.
 * A group-level DOI is usable only when every listed DOI is the same.
 */
export function workDoi(item: OrcidImportItem, summary: Work): string | null {
  type ExternalId = NonNullable<Work['externalIds']>[number]
  const candidates = (ids?: ExternalId[]) => [...new Set((ids ?? [])
    .filter(id => id['external-id-type']?.toLowerCase() === 'doi')
    .map(id => normalizedDoi(id['external-id-value'] ?? ''))
    .filter((doi): doi is string => doi !== null))]
  const detailed = candidates(item.work?.['external-ids']?.['external-id'])
  if (detailed.length) return detailed.length === 1 ? detailed[0] : null
  const preferred = candidates(summary.preferredExternalIds)
  if (preferred.length) return preferred.length === 1 ? preferred[0] : null
  const grouped = candidates(summary.externalIds)
  return grouped.length === 1 ? grouped[0] : null
}

export function isRateLimit(err: unknown) {
  return err instanceof ProviderHttpError &&
    (err.status === 429 || (err.provider === 'orcid' && err.status === 503))
}

export function errorMessage(
  err: unknown,
  fallback: string,
  invalidResponse: string,
  tooMany: string
) {
  if (isRateLimit(err)) {
    return tooMany
  }
  if (err instanceof ProviderResponseError) return invalidResponse
  return fallback
}

/** Search public ORCID author records. */
export async function searchOrcidAuthors(name: string, signal: AbortSignal) {
  const query = name.trim()
  if (!query || query.length > 200) throw new Error('Invalid author search')
  const parts = query.split(/\s+/)
  const escape = (value: string) => value.replace(SOLR_SPECIAL, '\\$1')
  const q = parts.length > 1
    ? `given-names:"${escape(parts.slice(0, -1).join(' '))}" AND family-name:"${escape(parts.at(-1)!)}"`
    : escape(query)
  const result = await fetchJSON(`${ORCID_PUBLIC_API}/expanded-search/?q=${encodeURIComponent(q)}&start=0&rows=20`, signal) as {
    'expanded-result'?: Array<Record<string, unknown>>
  }
  if (!Array.isArray(result?.['expanded-result'])) throw new ProviderResponseError('Invalid ORCID author response')
  return { results: result['expanded-result'].flatMap(author => {
    if (!author || typeof author !== 'object' ||
        typeof author['orcid-id'] !== 'string' || !isValidOrcid(author['orcid-id'])) return []
    return [{
      orcid: author['orcid-id'] as string,
      givenNames: typeof author['given-names'] === 'string' ? author['given-names'] : '',
      familyNames: typeof author['family-names'] === 'string' ? author['family-names'] : '',
      institutionNames: Array.isArray(author['institution-name'])
        ? author['institution-name'].filter((name): name is string => typeof name === 'string') : [],
    }]
  }) }
}

/** Fetch lightweight publication summaries. */
export async function fetchOrcidWorks(orcid: string, signal: AbortSignal) {
  const result = await fetchJSON(`${publicOrcid(orcid)}/works`, signal, 8 * 1024 * 1024)
  return { works: normalizeWorks(result) }
}

/** Fetch only the selected ORCID work details. */
export async function fetchOrcidWorkDetails(orcid: string, codes: number[], signal: AbortSignal) {
  validCodes(codes)
  const result = await fetchJSON(`${publicOrcid(orcid)}/works/${codes.join(',')}`, signal, 8 * 1024 * 1024) as {
    bulk?: Array<{ work?: OrcidWork & { citation?: { 'citation-type'?: string; 'citation-value'?: string } } }>
  }
  if (!Array.isArray(result?.bulk)) throw new ProviderResponseError('Invalid ORCID detail response')
  const returned = new Map<number, OrcidImportItem>()
  for (const row of result.bulk) {
    const code = (row?.work as OrcidWork & { 'put-code'?: number } | undefined)?.['put-code']
    if (Number.isSafeInteger(code) && code && codes.includes(code)) {
      const item = parseImportItem(formatWork(row.work!))
      if (item) returned.set(code, item)
    }
  }
  return { results: codes.map(putCode => ({ putCode, item: returned.get(putCode) ?? null })) }
}
