/**
 * Pure planners for mutations of the BibTeX source. These functions do not
 * modify CodeMirror; they only calculate and validate the text changes that
 * the extension may apply to the current document.
 *
 * Whole-entry and structural planners take the current document source;
 * planBibFieldWrite() instead receives one isolated source entry. Each returns
 * a guarded change plan without touching the DOM, React or CodeMirror.
 *
 * Source ranges are always resolved against the current document immediately
 * before the write. This is essential because source offsets become stale after
 * any insertion or deletion elsewhere in the file.
 */
import { parseBibFile } from './bib-entry-position'
import {
  hasBalancedCurlyBraces,
  hasBlockingValidationErrors,
  isWritableCitationKey,
  validateEntry,
} from './bib-validate'
import {
  bibCitationKeyRange,
  bibMissingKeyCommaRange,
  physicalLineStart,
  consumeOneNewline,
  physicalLineEnd,
  skipBibtexTrivia,
  isLikelyEntryStart,
  bibEntryHeaderAt,
} from './bib-source-scanner'
import { findTrustedFieldSource } from './bib-syntax-ranges'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'

export type BibWritePlan = {
  kind: 'replace' | 'append'
  /** inclusive start offset */
  from: number
  /** exclusive end offset (=== from for append) */
  to: number
  /** text to splice in between from and to */
  insert: string
  /** source offset where the entry itself begins after applying this plan */
  sourceStart?: number
}

export type BibWriteGuard =
  | { ok: true; plan: BibWritePlan }
  | { ok: false; reason: string }

const ENTRY_GONE_REASON = 'entry-gone'

const FIELD_NOT_FOUND_REASON = 'field-gone'
const INVALID_FIELD_VALUE_REASON = 'invalid-field-value'

function replacePlan(from: number, to: number, insert: string): BibWriteGuard {
  return { ok: true, plan: { kind: 'replace', from, to, insert, sourceStart: from } }
}

type ParsedSourceEntry = ReturnType<typeof parseBibFile>[number]

/** Find one exact source occurrence without allocating a filtered array. */
function findUniqueEntryByStart(
  entries: ParsedSourceEntry[],
  sourceStart: number
): ParsedSourceEntry | null {
  let match: ParsedSourceEntry | null = null
  for (const entry of entries) {
    if (entry.from !== sourceStart) continue
    if (match) return null
    match = entry
  }
  return match
}

/** Build a source-offset index once for operations resolving several entries. */
function indexUniqueEntriesByStart(
  entries: ParsedSourceEntry[]
): Map<number, ParsedSourceEntry | null> {
  const byStart = new Map<number, ParsedSourceEntry | null>()
  for (const entry of entries) {
    if (byStart.has(entry.from)) byStart.set(entry.from, null)
    else byStart.set(entry.from, entry)
  }
  return byStart
}

/**
 * A malformed source range must not swallow a later entry-looking directive.
 * Lezer is authoritative for trusted entries; these may legitimately contain
 * an @-directive in a quoted or braced field. For *untrusted* ranges, fail
 * closed if there is another line-start entry marker, regardless of whether a
 * brace eventually closes: that brace could belong to the following entry.
 */
function containsPossibleFollowingEntry(
  source: string,
  from: number,
  to: number
): boolean {
  for (let i = from + 1; i < to; i++) {
    if (source[i] === '@' && isLikelyEntryStart(source, i)) return true
  }
  return false
}

/** Only a complete, error-free Lezer entry has trustworthy source boundaries. */
function unsafeWholeEntryRange(
  source: string,
  entry: ParsedSourceEntry
): boolean {
  if (entry.sourceFieldRanges !== undefined) return false
  // A damaged @type without an opener has no replaceable outer entry.
  if (!bibEntryHeaderAt(source, entry.from)) return true
  return containsPossibleFollowingEntry(source, entry.from, entry.to)
}

/**
 * Check both editable field text and the exact source representation emitted
 * by BibtexFieldValue.toString(). This is deliberately repeated at the write
 * boundary: a malformed raw value must not become a malformed BibTeX fragment
 * if conversion/serialization normalizes it differently from the form text.
 */
function hasSafeSerializedFieldValues(entry: BibtexEntry): boolean {
  return entry.getFieldsArray().every(({ value }) =>
    hasBalancedCurlyBraces(value.toEditableString()) &&
    hasBalancedCurlyBraces(value.toString())
  )
}

function hasSafeSerializedEntry(entry: BibtexEntry): boolean {
  return (
    hasSafeSerializedFieldValues(entry) &&
    hasBalancedCurlyBraces(entry.toString())
  )
}

/**
 * Locate the optional comma after a value, skipping interspersed whitespace
 * and `%` comments. Keep the exact comma offset: the text before it may
 * contain comments that an edit must preserve.
 */
function fieldSeparatorAfter(source: string, valueEnd: number): {
  commaAt: number | null
  after: number
} {
  const at = skipBibtexTrivia(source, valueEnd)
  const commaAt = source[at] === ',' ? at : null
  return {
    commaAt,
    after: skipBibtexTrivia(source, commaAt === null ? at : at + 1),
  }
}

/** Follow the first physical line ending already used by the document. */
function sourceNewline(source: string): string {
  return source.match(/\r\n|\r|\n/)?.[0] ?? '\n'
}

/** Match generated BibTeX text to the document's newline convention. */
function serializeForSource(entry: BibtexEntry, newline: string): string {
  return entry.toString().replace(/\r\n|\r|\n/g, newline)
}

/** Format an append without rewriting any existing source text. */
function appendBibEntries(
  source: string,
  entries: BibtexEntry[]
): { insert: string; sourceStart: number } {
  const newline = sourceNewline(source)
  const endsInNewline = source.endsWith('\n') || source.endsWith('\r')
  const separator = source.length > 0 && !endsInNewline ? newline : ''
  const trailingNewline = endsInNewline ? newline : ''
  return {
    insert: `${separator}${entries.map(entry => serializeForSource(entry, newline)).join(newline)}${trailingNewline}`,
    sourceStart: source.length + separator.length,
  }
}

export type BibFieldWriteTarget =
  | { kind: 'entry-type' }
  | { kind: 'citation-key' }
  | { kind: 'field'; name: string }

/**
 * Plan a small visual-editor mutation inside one already-resolved entry.
 * `source` is only the entry text, never the complete bibliography.
 */
export function planBibFieldWrite(
  source: string,
  entry: BibtexEntry,
  target: BibFieldWriteTarget,
  existingField?: boolean
): BibWriteGuard {
  if (target.kind === 'citation-key') {
    if (!isWritableCitationKey(entry.key)) {
      return { ok: false, reason: INVALID_FIELD_VALUE_REASON }
    }

    const entryHeader = bibEntryHeaderAt(source, 0)
    const keyRange = entryHeader ? bibCitationKeyRange(source, entryHeader) : null
    if (keyRange) {
      return replacePlan(keyRange.from, keyRange.to, entry.key)
    }

    // Recover headers missing the comma before the first field. Repair the
    // separator while changing the key so the entry becomes safely writable.
    const malformed = entryHeader ? bibMissingKeyCommaRange(source, entryHeader) : null
    if (malformed) {
      return replacePlan(malformed.from, malformed.to, `${entry.key},`)
    }

    return { ok: false, reason: ENTRY_GONE_REASON }
  }

  if (target.kind === 'entry-type') {
    const header = bibEntryHeaderAt(source, 0)
    if (!header) return { ok: false, reason: ENTRY_GONE_REASON }
    return replacePlan(header.typeFrom, header.typeTo, entry.type)
  }

  const normalized = target.name.toLowerCase()
  const fieldExistsInSourceModel = existingField ?? entry.hasField(normalized)
  const trusted = findTrustedFieldSource(source)
  // The fields and closing delimiter must come from the same trusted Lezer
  // entry; never infer either from malformed source.
  if (!trusted) return { ok: false, reason: ENTRY_GONE_REASON }
  const sourceFieldRanges = trusted.fields
  const range = sourceFieldRanges.reduce<(typeof sourceFieldRanges)[number] | null>(
    (found, candidate) => candidate.name === normalized ? candidate : found,
    null
  )
  const value = entry.getField(normalized)

  // Format warnings (including malformed URLs) are informational. The
  // structural checks below still reject unbalanced braces
  // before serializing the value into the bibliography source.

  // Keep the structural guard at the serialization boundary as well as in the
  // React form. This is field-local so another valid field can still be saved.
  const serializedValue = value.toString()
  if (
    entry.hasField(normalized) &&
    (!hasBalancedCurlyBraces(value.toEditableString()) ||
      !hasBalancedCurlyBraces(serializedValue))
  ) {
    return { ok: false, reason: INVALID_FIELD_VALUE_REASON }
  }

  const insertValue = serializedValue.replace(/\r\n|\r|\n/g, sourceNewline(source))

  if (range) {
    if (!entry.hasField(normalized)) {
      let from = range.fieldFrom
      let to = range.valueTo

      const lineStart = physicalLineStart(source, from)
      const before = source.slice(lineStart, from)
      const separator = fieldSeparatorAfter(source, to)
      // Preserve source comments between the removed value and its comma.
      // A plain range deletion would erase those comments; leaving the comma
      // behind instead can make upstream discard the following field.
      let insert = ''
      if (separator.commaAt !== null) {
        insert = source.slice(to, separator.commaAt)
        to = separator.commaAt + 1
      }

      const afterField = source.slice(to)
      if (
        before.trim() === '' &&
        insert.trim() === '' &&
        /^[ \t]*(?:\r\n|\r|\n|$)/.test(afterField)
      ) {
        from = lineStart
        to = consumeOneNewline(source, physicalLineEnd(source, to))
        insert = ''
      }

      return replacePlan(from, to, insert)
    }

    return replacePlan(range.valueFrom, range.valueTo, insertValue)
  }

  // When the current source already contains the field according to the
  // current parsed entry, failing to locate its source range is never a reason
  // to guess where the field belongs. Falling through here would use the last
  // `}` in the supplied entry text as an insertion point, which can turn a
  // stale/truncated range into a field inserted inside another field value.
  if (fieldExistsInSourceModel) {
    return { ok: false, reason: FIELD_NOT_FOUND_REASON }
  }

  if (!entry.hasField(normalized)) {
    return { ok: false, reason: FIELD_NOT_FOUND_REASON }
  }

  const close = trusted.close
  const newline = sourceNewline(source)
  const lastField = sourceFieldRanges[sourceFieldRanges.length - 1]

  // Insert after the last value, or after the citation key if there are no
  // fields. Both cases share the same trailing separator and comment rules.
  let from = lastField?.valueTo
  if (from === undefined) {
    const header = bibEntryHeaderAt(source, 0)
    const keyRange = header ? bibCitationKeyRange(source, header) : null
    if (!keyRange) return { ok: false, reason: ENTRY_GONE_REASON }
    from = keyRange.to
  }
  if (from > close) return { ok: false, reason: ENTRY_GONE_REASON }

  const separator = fieldSeparatorAfter(source, from)
  if (separator.after !== close) {
    return { ok: false, reason: ENTRY_GONE_REASON }
  }

  const tail = source.slice(from, close)
  // Existing field values need a fresh comma if their tail contains only
  // whitespace. Otherwise keep the original separator and comments verbatim.
  const prefix = lastField && !tail.includes('%')
    ? ','
    : `${separator.commaAt === null ? ',' : ''}${tail.replace(/[ \t\r\n]+$/, '')}`
  const insert = `${prefix}${newline}  ${normalized} = ${insertValue},${newline}`

  return replacePlan(from, close, insert)
}


/**
 * Plan a write of a single entry against the *current* source.
 *
 * mode 'existing': the extension supplies the current source start for the
 * occurrence it resolved from its own CodeMirror state. Citation keys are not
 * used for targeting because they are not unique.
 *
 * mode 'new': the entry is appended at the end of the source.
 *
 * Existing-entry ranges are clamped into [0, source.length].
 */
export function planBibWrite(
  source: string,
  entry: BibtexEntry,
  mode: 'existing' | 'new',
  entryStart?: number
): BibWriteGuard {
  // This planner serializes an entire entry. Reject it while any field is
  // structurally invalid; existing entries use planBibFieldWrite for field-local
  // changes, allowing valid fields to save while another field remains invalid.
  if (!hasSafeSerializedEntry(entry)) {
    return { ok: false, reason: INVALID_FIELD_VALUE_REASON }
  }

  if (mode === 'existing') {
    if (entryStart === undefined) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    const entries = parseBibFile(source)
    // The source start is resolved by the CodeMirror extension from the current
    // entry id, identifying the exact duplicate-key occurrence.
    const own = findUniqueEntryByStart(entries, entryStart)
    if (!own) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    const { from: entryFrom, to: entryTo } = own
    const from = Math.max(0, Math.min(entryFrom, source.length))
    const to = Math.max(0, Math.min(entryTo, source.length))
    // Trust complete upstream entries; guard only ambiguous recovered ranges.
    if (unsafeWholeEntryRange(source, own)) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    return replacePlan(from, to, serializeForSource(entry, sourceNewline(source)))
  }

  if (hasBlockingValidationErrors(validateEntry(entry))) {
    return { ok: false, reason: INVALID_FIELD_VALUE_REASON }
  }

  // Append without rewriting existing entries.
  const { insert, sourceStart } = appendBibEntries(source, [entry])
  return {
    ok: true,
    plan: {
      kind: 'append',
      from: source.length,
      to: source.length,
      insert,
      sourceStart,
    },
  }
}

export type BibBulkDeleteGuard =
  | { ok: true; changes: { from: number; to: number; insert: string }[] }
  | { ok: false; reason: string }

/**
 * Plan a bulk delete against the current source. The operation is
 * all-or-nothing: if any requested source occurrence no longer exists, none of
 * the requested deletions is returned. Ranges are sorted so the caller can apply
 * them as one CodeMirror change set.
 */
export function planBibBulkDelete(
  source: string,
  entryStarts: number[]
): BibBulkDeleteGuard {
  const unique = [...new Set(entryStarts)]
  if (unique.length === 0) {
    // Nothing selected is a successful no-op; the caller can skip dispatching
    // because there are no changes to apply.
    return { ok: true, changes: [] }
  }
  const entries = parseBibFile(source)
  const entryByStart = indexUniqueEntriesByStart(entries)
  const ranges: { from: number; to: number }[] = []
  for (const entryStart of unique) {
    const match = entryByStart.get(entryStart)
    if (!match) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    const { from: entryFrom, to: entryTo } = match
    if (unsafeWholeEntryRange(source, match)) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    // Keep the bulk operation consistent with single-entry deletion: remove
    // one separator line break, not an entire run of blank lines.
    const end = consumeOneNewline(source, entryTo)
    ranges.push({ from: entryFrom, to: end })
  }
  ranges.sort((a, b) => a.from - b.from)
  // Parsed entries should never overlap. Treat overlap as a guard failure rather
  // than risk producing an invalid CodeMirror change set.
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].from < ranges[i - 1].to) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
  }
  return {
    ok: true,
    changes: ranges.map(r => ({ from: r.from, to: r.to, insert: '' })),
  }
}

export type BibImportInsert = {
  from: number
  to: number
  insert: string
}

export type BibImportGuard =
  | { ok: true; changes: BibImportInsert[] }
  | { ok: false; reason: string }

const KEY_CONFLICT_REASON = 'key-conflict'

/**
 * Plan a multi-entry import as one guarded append. Missing citation keys are
 * rejected, as are keys with invalid characters. Duplicate keys are allowed
 * both against the document and within the imported batch because entries are
 * identified by source occurrence in this editor, not by key uniqueness.
 *
 * The resulting text uses the same newline rules as a normal new-entry append.
 * A leading separator is added only when the current document does not already
 * end in a newline.
 */
export function planBibImport(
  source: string,
  entries: BibtexEntry[]
): BibImportGuard {
  // This planner is reached only from the .bib visual editor. An import is
  // also valid when the bibliography is currently empty.
  if (entries.length === 0) {
    return { ok: true, changes: [] }
  }
  if (entries.some(entry => entry.key.trim() === '' || !isWritableCitationKey(entry.key))) {
    return { ok: false, reason: KEY_CONFLICT_REASON }
  }
  if (entries.some(entry => !hasSafeSerializedEntry(entry))) {
    return { ok: false, reason: INVALID_FIELD_VALUE_REASON }
  }
  const { insert } = appendBibEntries(source, entries)
  return {
    ok: true,
    changes: [{ from: source.length, to: source.length, insert }],
  }
}
