/**
 * Pure helpers for the entry-list/preview UI. Keeping these decisions outside
 * the React components makes selection, navigation, search and filenames easy to test.
 *
 * The preview panel is a view over the current parsed `entries` list: no
 * document state, just indices into it. These helpers keep the panel
 * component thin and the edge cases (boundaries, empty list, bulk selection,
 * required-missing labels, humanized summary, download filename) unit
 * testable without a DOM.
 *
 * Field labels are shared with the form because the same names appear in both
 * validation messages and the preview's missing-field summary.
 */
import { missingRequiredFieldGroups, type PositionedBibtexEntry } from './bib-types'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { BibtexFieldValue } from '@shared/bibtex/bibtex-field-value.mts'
import { splitBibtexAnd } from './bib-author-names'
import { fieldLabel } from './bib-field-labels'

/**
 * Produce a label for each missing required-field group. Members of an
 * alternative group are joined with "or" (for example, "Year or Date"), while
 * separate required groups remain comma-separated by the caller.
 */
export function missingRequiredLabels(
  entry: BibtexEntry,
  or: string
): string[] {
  const groups = missingRequiredFieldGroups(entry)
  const labels = groups.map(group =>
    [...new Set(group)].map(field => fieldLabel(field)).join(` ${or} `)
  )
  return labels
}

/** Adjacent entry, or null at either end of the list. */
function adjacentEntry<T>(entries: readonly T[], index: number, direction: -1 | 1): T | null {
  return entries[index + direction] ?? null
}

export function prevEntry<T>(entries: readonly T[], index: number): T | null {
  return adjacentEntry(entries, index, -1)
}

export function nextEntry<T>(entries: readonly T[], index: number): T | null {
  return adjacentEntry(entries, index, 1)
}

/** Keep only selected occurrence ids that are still present in the current projection. */
export function bulkDeleteIds(
  entries: PositionedBibtexEntry[],
  selectedIds: string[]
): string[] {
  const present = new Set(entries.map(e => e.entry.id))
  return selectedIds.filter(id => present.has(id))
}

/** Download filename for a single previewed entry. */
export function downloadBibEntryFilename(citationKey: string): string {
  const name = citationKey.trim()
  return `${name || 'entry'}.bib`
}

/** Download filename for a bulk selection. */
export function downloadBibBulkFilename(openDocName: string): string {
  const name = (openDocName || '').trim()
  return name.endsWith('.bib') ? 'selected_' + name : `selected_${name || 'bibliography'}.bib`
}

/**
 * Build the text searched by the entry list. The search intentionally covers only
 * the fields that are useful when scanning a bibliography row: citation key,
 * title, author, editor, year, date, and venue.
 * (journal/journaltitle/booktitle). Empty query matches everything.
 */
export function matchesSearch(positioned: PositionedBibtexEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const entry = positioned.entry
  const field = (name: string) => entry.getField(name).toDisplayString()
  const matchesNames = (name: 'author' | 'editor') =>
    splitBibtexAnd(entry.getField(name).toEditableString()).some(author =>
      BibtexFieldValue.fromEditableString(author)
        .toDisplayString()
        .toLowerCase()
        .includes(q)
    )
  return [
    entry.key,
    field('title'),
    field('year'),
    field('date'),
    field('journal'),
    field('journaltitle'),
    field('booktitle'),
  ].some(value => value.toLowerCase().includes(q)) ||
    matchesNames('author') || matchesNames('editor')
}

/**
 * Split text into alternating plain/match segments so the card can render
 * matching pieces with <mark>. Matching is case-insensitive and literal.
 * Non-query input → a single plain segment; empty text → no segments.
 */
export function splitHighlighted(
  text: string,
  query: string
): { text: string; match: boolean }[] {
  const needle = query.trim().toLowerCase()
  if (text === '') return []
  if (needle === '') return [{ text, match: false }]
  const lower = text.toLowerCase()
  if (!lower.includes(needle)) return [{ text, match: false }]

  // Map each lowercased UTF-16 offset back to its original character.
  // Use whole-string lowercasing for matches: it is context-sensitive
  // (e.g. Greek final sigma), unlike lowercasing characters separately.
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0
  for (const character of text) {
    const end = offset + character.length
    for (let i = 0; i < character.toLowerCase().length; i++) {
      starts.push(offset)
      ends.push(end)
    }
    offset = end
  }

  const segments: { text: string; match: boolean }[] = []
  let sourceEnd = 0
  let searchFrom = 0
  while (searchFrom < lower.length) {
    const idx = lower.indexOf(needle, searchFrom)
    if (idx === -1) break
    const from = starts[idx]
    const to = ends[idx + needle.length - 1]
    searchFrom = idx + needle.length
    // Two folded substrings can overlap the same original character.
    if (from < sourceEnd) continue
    if (from > sourceEnd) segments.push({ text: text.slice(sourceEnd, from), match: false })
    segments.push({ text: text.slice(from, to), match: true })
    sourceEnd = to
  }
  if (sourceEnd < text.length) {
    segments.push({ text: text.slice(sourceEnd), match: false })
  }
  return segments
}
