/**
 * Convert upstream BibTeX parsing into positioned visual-editor entries.
 *
 * Lezer determines entry boundaries. Incomplete entries with a recognizable
 * header can be recovered; directives without an opener are not visual entries.
 */
import { NON_BIBLIOGRAPHY_ENTRY_TYPES } from './bib-constants'
import { parseBibtex } from '@/features/bibtex/bibtex-parser'
import { PositionedBibtexEntry } from '@/features/bibtex/positioned-bibtex-entry'
import { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import {
  bibEntryHeaderAt,
  skipBibtexTrivia,
  bibCitationKeyRange,
} from './bib-source-scanner'
import {
  findSyntaxEntryProjection,
  projectKeylessEntry,
  type BibFieldSourceRange,
  type BibSyntaxEntryProjection,
} from './bib-syntax-ranges'

/** Source-relative Lezer field ranges are present only for trusted complete entries. */
export type BibProjectedEntry = PositionedBibtexEntry & {
  sourceFieldRanges?: BibFieldSourceRange[]
}

type SourceRange = { from: number; to: number }

function positioned(entry: BibtexEntry, from: number, to: number): BibProjectedEntry {
  return Object.assign(new PositionedBibtexEntry(), { entry, from, to })
}

/** A trusted node has real delimiters, no Lezer errors, and a matching key. */
function trustedEntry(source: string, node: BibSyntaxEntryProjection): BibtexEntry | null {
  if (!node.clean || !node.entry || !node.citationKey) return null
  const { from, to } = node.citationKey
  return node.entry.key === source.slice(from, to) ? node.entry : null
}

/**
 * Isolated incremental/undo parsing. Even an incomplete entry can be shown
 * if upstream's parser recovered it; its syntax diagnostics disable editing.
 */
export function parseBibEntryAt(
  source: string,
  from: number,
  knownTo?: number
): BibProjectedEntry | null {
  if (from < 0 || from >= source.length || source[from] !== '@') return null
  const header = bibEntryHeaderAt(source, from)
  if (!header || NON_BIBLIOGRAPHY_ENTRY_TYPES.has(header.type)) return null
  const to = knownTo ?? (() => {
    const syntax = findSyntaxEntryProjection(source, false)
    const entry = syntax.entries.find(item => item.from === from)
    if (!entry) return from
    return entry.closed ? entry.to :
      (syntax.blockStarts.find(start => start > from) ?? source.length)
  })()
  if (to <= from) return null

  const raw = source.slice(from, to)
  const keyStart = skipBibtexTrivia(source, header.open + 1)
  const keyless = projectKeylessEntry(raw)
  if (keyless) {
    const result = positioned(keyless.entry, from, from + keyless.close + 1)
    result.sourceFieldRanges = keyless.fields
    return result
  }
  const parsed = parseBibtex(raw).entries[0]
  // The upstream parser may recover a nested entry instead of the entry at
  // this offset. Never assign that nested entry to the outer source range.
  if (parsed?.key && source.startsWith(parsed.key, keyStart)) {
    return positioned(parsed, from, to)
  }

  // Lezer recognized this malformed entry, but upstream could not construct
  // its content. Display a minimal entry; the source diagnostics mark it bad.
  const keyRange = bibCitationKeyRange(source, header)
  const key = keyRange && keyRange.to <= to
    ? source.slice(keyRange.from, keyRange.to)
    : ''
  return positioned(new BibtexEntry({ type: header.type, key }), from, to)
}

/**
 * Parse the complete document once with Lezer. A syntax error may require
 * boundary discovery, but field values always come from upstream parsers.
 */
export function parseBibFile(
  source: string,
  range?: SourceRange,
  trustedWindow?: SourceRange
): BibProjectedEntry[] {
  const from = Math.max(0, range?.from ?? 0)
  const to = Math.min(source.length, range?.to ?? source.length)
  if (to <= from) return []

  // On undo/redo, the extension knows the surviving entry boundaries. Parse
  // only the gap between those entries when every entry in it is complete.
  // Ambiguous/incomplete regions fall back to the original full projection.
  if (range && trustedWindow &&
    0 <= trustedWindow.from && trustedWindow.from <= from &&
    to <= trustedWindow.to && trustedWindow.to <= source.length) {
    const local = parseBibFile(source.slice(trustedWindow.from, trustedWindow.to))
    if (local.length && local.every(entry =>
      entry.sourceFieldRanges !== undefined &&
      entry.to <= trustedWindow.to - trustedWindow.from &&
      (entry.from < from - trustedWindow.from ||
        !source.slice(to, trustedWindow.from + entry.to).trim())
    )) {
      return local.filter(entry =>
        entry.from >= from - trustedWindow.from && entry.from < to - trustedWindow.from
      ).map(entry => {
        entry.from += trustedWindow.from
        entry.to = Math.min(to, entry.to + trustedWindow.from)
        return entry
      })
    }
  }

  const { entries, blockStarts } = findSyntaxEntryProjection(source)
  let nextBlock = 0
  return entries.flatMap(node => {
    while (nextBlock < blockStarts.length && blockStarts[nextBlock] <= node.from) nextBlock++
    // Incomplete entries leave their content in Junk. Stop at the next Lezer
    // block, including @comment, @string, @preamble and % comments.
    const end = node.closed ? node.to : (blockStarts[nextBlock] ?? source.length)
    const entryTo = Math.min(end, to)
    if (node.from < from || node.from >= to || entryTo <= node.from) return []
    // An empty citation key is valid source for the visual editor. Upstream
    // cannot parse its fields directly, so use an isolated in-memory projection.
    const keyless = projectKeylessEntry(source.slice(node.from, entryTo))
    if (keyless) {
      const result = positioned(keyless.entry, node.from, node.from + keyless.close + 1)
      result.sourceFieldRanges = keyless.fields
      return [result]
    }
    // Use the upstream accumulator's partial entry when possible. Unlike an
    // isolated reparse, it cannot accidentally select a nested sibling.
    if (!node.entry) {
      const partial = parseBibEntryAt(source, node.from, entryTo)
      return partial ? [partial] : []
    }
    const result = positioned(node.entry, node.from, entryTo)
    if (trustedEntry(source, node)) {
      result.sourceFieldRanges = node.fields.map(field => ({
        ...field,
        fieldFrom: field.fieldFrom - node.from,
        valueFrom: field.valueFrom - node.from,
        valueTo: field.valueTo - node.from,
      }))
    }
    return [result]
  })
}

/**
 * Reproject a guarded field/header edit within its already-known entry range.
 * The range comes from CodeMirror's current occurrence and transaction mapping,
 * not from the citation key. Lezer sees only this entry, so ordinary field
 * writes do not parse the full bibliography again. If the range contains more
 * than one entry or is not entirely owned by one entry, let the caller fall
 * back to full-document discovery.
 */
export function parseBibEntryInRange(
  source: string,
  from: number,
  to: number
): BibProjectedEntry | null {
  if (from < 0 || to > source.length || from >= to || source[from] !== '@') return null
  const entries = parseBibFile(source.slice(from, to))
  if (entries.length !== 1 || entries[0].from !== 0 || entries[0].to !== to - from) {
    return null
  }
  const entry = entries[0]
  entry.from = from
  entry.to = to
  return entry
}
