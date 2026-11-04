import { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { BibtexFieldValue } from '@shared/bibtex/bibtex-field-value.mts'
import { BIBTEX_CITATION_KEY_REGEX } from '@shared/bibtex/bibtex-identifier.mts'
import { generateAvailableCitationKey, pickAvailableKeyForEntry } from './bib-key-generation'
import { splitImportText } from './bib-import'
import { isValidDoi, normaliseDoi } from './bib-doi'
import { crossRefMessageToEntry } from './doi-fetcher'
import type { OrcidImportItem, OrcidWork } from '../orcid/orcid-api'

function fromOrcidWork(work: OrcidWork): BibtexEntry {
  const fields = new Map<string, BibtexFieldValue>()
  const add = (field: string, value?: string) => {
    if (value?.trim()) fields.set(field, new BibtexFieldValue().addString(value.trim()))
  }

  const journal = work['journal-title']?.value
  const type = work.type === 'journal-article' && journal ? 'article'
    : work.type === 'conference-paper' && journal ? 'inproceedings'
      : 'misc'

  add('title', work.title?.title?.value)
  add('year', work['publication-date']?.year?.value)
  add(type === 'article' ? 'journal' : type === 'inproceedings' ? 'booktitle' : 'howpublished', journal)

  const contributors = work.contributors?.contributor ?? []
  for (const role of ['author', 'editor'] as const) {
    const names = contributors
      .filter(person => (person['contributor-attributes']?.['contributor-role'] || 'author') === role)
      .map(person => person['credit-name']?.value?.trim())
      .filter((name): name is string => Boolean(name))
      // Protect corporate names containing the BibTeX name separator.
      .map(name => /\s+and\s+/i.test(name) ? `{${name}}` : name)
    add(role, names.join(' and '))
  }

  const doi = work['external-ids']?.['external-id']?.find(
    id => id['external-id-type']?.toLowerCase() === 'doi'
  )?.['external-id-value']
  if (doi) {
    const normalized = normaliseDoi(doi)
    if (isValidDoi(normalized)) add('doi', normalized)
  }

  return new BibtexEntry({ type, key: '', fields })
}

/** Only the editor interprets BibTeX/DOI metadata and assigns citation keys. */
function parseCitation(text: string): BibtexEntry | null {
  const parsed = splitImportText(text)
  return parsed.length === 1 && parsed[0].kind === 'bibtex' ? parsed[0].entry : null
}

function isSafeEntry(entry: BibtexEntry): boolean {
  return !!parseCitation(entry.setKey(entry.key || 'orcid-import').toString())
}

function mergeFields(entry: BibtexEntry, source: BibtexEntry, overwrite = false): BibtexEntry {
  for (const field of source.getFields()) {
    const value = source.getField(field)
    if (!value.toDisplayString().trim()) continue
    if (overwrite || !entry.getField(field).toDisplayString().trim()) {
      entry = entry.setField(field, value)
    }
  }

  // The provider's year is authoritative when enrichment was requested.
  // Do not retain a contradictory date from the earlier ORCID citation.
  if (overwrite) {
    const year = source.getField('year').toDisplayString().trim()
    const date = source.getField('date').toDisplayString().trim()
    const oldDate = entry.getField('date').toDisplayString().trim()
    if (year && !date && oldDate && !oldDate.startsWith(year)) {
      entry = entry.deleteField('date')
    } else if (date && !year) {
      const oldYear = entry.getField('year').toDisplayString().trim()
      const dateYear = date.match(/^\d{4}/)?.[0]
      if (oldYear && dateYear && oldYear !== dateYear) entry = entry.deleteField('year')
    }
  }
  return entry
}

/** Merge available sources without assigning a citation key, recording whether
 * Crossref changed final metadata, and whether provider data was unusable. */
function mergedOrcidEntry(item: OrcidImportItem): {
  entry: BibtexEntry; enriched: boolean; unusableCrossref: boolean
} | null {
  const citation = 'bibtex' in item ? parseCitation(item.bibtex) : null
  if ('bibtex' in item && !citation) return null

  // Convert structured Crossref metadata using the existing editor converter.
  // An invalid response must not make the original ORCID record unusable.
  let doi: BibtexEntry | null = null
  let unusableCrossref = false
  if (item.doi?.crossref) {
    // DOI metadata is optional. An invalid provider response must not make an
    // otherwise valid ORCID citation unusable.
    try {
      const candidate = crossRefMessageToEntry(item.doi.crossref).entry
      if (isSafeEntry(candidate)) doi = candidate
      else unusableCrossref = true
    } catch {
      unusableCrossref = true
    }
  }

  // Preserve the original citation key; Crossref fields take precedence
  // when a DOI was explicitly retrieved. ORCID fills remaining gaps.
  const workEntry = item.work ? fromOrcidWork(item.work) : null
  let entry = citation || workEntry || doi
  if (!entry) return null
  if (citation && workEntry) {
    const merged = mergeFields(entry, workEntry)
    if (isSafeEntry(merged)) entry = merged
  }

  const beforeDoi = entry
  if (doi && entry !== doi) {
    try {
      let merged = mergeFields(entry, doi, true)
      // Preserve the original citation key if the provider generated another.
      if (!citation && !merged.key && doi.key &&
          BIBTEX_CITATION_KEY_REGEX.exec(doi.key)?.[0] === doi.key) {
        merged = merged.setKey(doi.key)
      }
      // An explicit provider type can also supersede an ORCID fallback type.
      if (item.doi?.crossref?.type) merged = merged.setType(doi.type)
      if (isSafeEntry(merged)) entry = merged
      else unusableCrossref = true
    } catch {
      // Unusable enrichment must not discard a valid ORCID record.
      unusableCrossref = true
    }
  }

  // Validate the fully merged entry once, without writing any temporary key.
  const checked = parseCitation(entry.setKey(entry.key || 'orcid-import').toString())
  if (!checked) return null
  const finalEntry = checked.setKey(entry.key)
  const enriched = !!doi && (entry === doi || finalEntry.type !== beforeDoi.type ||
    [...new Set([...finalEntry.getFields(), ...beforeDoi.getFields()])].some(field =>
      finalEntry.getField(field).toDisplayString() !== beforeDoi.getField(field).toDisplayString()
    ))
  return { entry: finalEntry, enriched, unusableCrossref }
}

/** Validate and assess metadata without generating a citation key. */
export function inspectOrcidImport(item: OrcidImportItem): { needsMetadata: boolean } | null {
  try {
    const result = mergedOrcidEntry(item)
    if (!result) return null
    const entry = result.entry
    return { needsMetadata: entry.getAuthors().names.length === 0 ||
      !entry.getField('year').toDisplayString().trim() }
  } catch {
    return null
  }
}

/** The editor, not the ORCID server, owns BibTeX parsing and citation keys. */
export function prepareOrcidImport(
  items: OrcidImportItem[],
  existingKeys: readonly string[]
): { entries: BibtexEntry[]; enriched: number; unusableIndices: number[]; skippedIndices: number[] } | null {
  if (items.length === 0) return null
  let enriched = 0
  const unusableIndices: number[] = []
  const skippedIndices: number[] = []
  const keys = [...existingKeys]
  const entries: BibtexEntry[] = []

  for (const [index, item] of items.entries()) {
    try {
      const merged = mergedOrcidEntry(item)
      if (!merged) {
        skippedIndices.push(index)
        continue
      }
      let entry = merged.entry
      if (!entry.key.trim() || BIBTEX_CITATION_KEY_REGEX.exec(entry.key)?.[0] !== entry.key) {
        // Assign keys only after successful preparation, preserving deterministic order.
        entry = entry.setKey(generateAvailableCitationKey(entry, keys, ''))
      } else if (keys.includes(entry.key)) {
        entry = entry.setKey(pickAvailableKeyForEntry(entry.key, keys))
      }
      keys.push(entry.key)
      entries.push(entry)
      if (merged.enriched) enriched++
      else if (merged.unusableCrossref) unusableIndices.push(index)
    } catch {
      // One malformed entry must not interrupt preparation of other references.
      // The remaining valid entries are still committed atomically by the caller.
      skippedIndices.push(index)
    }
  }
  return entries.length ? { entries, enriched, unusableIndices, skippedIndices } : null
}
