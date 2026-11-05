/** Shared DOI input conventions for paste detection and metadata fetching. */
const DOI_PREFIX = /^(?:(?:https?:\/\/)?(?:dx\.)?doi\.org\/|doi:\s*)/i
const DOI = /^10\.\d{4,9}\/\S+$/

/** Accept a bare DOI, doi: prefix, or doi.org URL with or without a scheme. */
export function normaliseDoi(raw: string): string {
  return raw.trim().replace(DOI_PREFIX, '')
}

/** Classify pasted DOI input, including malformed prefixed DOIs for diagnostics. */
export function isDoiLine(raw: string): boolean {
  const text = raw.trim()
  const normalized = normaliseDoi(text)
  return DOI.test(normalized) || (normalized !== text && normalized.length > 0)
}

export function isValidDoi(doi: string): boolean {
  return DOI.test(doi)
}

/** Preserve DOI slash separators while escaping reserved characters in URL paths. */
export function encodeDoiPath(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/')
}
