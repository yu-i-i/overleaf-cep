/**
 * Helpers for turning pasted bibliography/DOI input into BibtexEntry values. This
 * module normalizes imported citation keys before they reach the write path.
 */
import { NON_BIBLIOGRAPHY_ENTRY_TYPES } from './bib-constants'
import { BIBTEX_CITATION_KEY_REGEX } from '@shared/bibtex/bibtex-identifier.mts'
import { parseBibFile } from './bib-entry-position'
import {
  bibEntryHeaderAt,
  physicalLineEnd,
  consumeOneNewline,
  skipBibtexTrivia,
} from './bib-source-scanner'
import { validateBibSource } from './bib-source-diagnostics'
import type { BibSourceDiagnostic } from './bib-source-diagnostics'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { generateCitationKey } from './bib-key-generation'
import { findSyntaxEntryProjection, findSyntaxSourceBlocks, analyzeBibSyntax } from './bib-syntax-ranges'
import type { BibSyntaxProjection, BibSyntaxEntryProjection } from './bib-syntax-ranges'
import { isDoiLine } from './bib-doi'
import { humanizeCitationHeading } from './overleaf-type-map.ts'

export type BibImportItem =
  | { kind: 'bibtex'; entry: BibtexEntry; raw: string }
  | { kind: 'doi'; raw: string }
  | { kind: 'error'; raw: string; error?: string; errors?: BibSourceDiagnostic[]; syntaxError?: boolean }

export function splitImportText(text: string): BibImportItem[] {
  const items: BibImportItem[] = []
  let position = 0
  // The full-text Lezer tree already contains trusted entries and their
  // boundaries. Reuse it instead of reparsing every complete import candidate.
  const syntax = analyzeBibSyntax(text)
  let blocks = syntax.blocks
  const entries = new Map(syntax.entries.map(entry => [entry.from, entry]))
  const invalid = new Set(validateBibSource(text, syntax).map(item => item.entryFrom))
  let canReuse = true
  let blockIndex = 0

  while (position < text.length) {
    const end = physicalLineEnd(text, position)
    const line = text.slice(position, end)
    const trimmed = line.trim()

    if (!trimmed) {
      position = consumeOneNewline(text, end)
      continue
    }
    if (trimmed.startsWith('%')) {
      // Upstream ignores free-standing BibTeX line comments during parsing.
      position = consumeOneNewline(text, end)
      continue
    }
    if (isDoiLine(trimmed)) {
      items.push({ kind: 'doi', raw: trimmed })
    } else {
      // Lezer discovers BibTeX blocks; ordinary lines may be DOI references.
      while (blocks[blockIndex] && blocks[blockIndex].from < position) blockIndex++
      const candidate = blocks[blockIndex]
      const block = candidate?.from < end ? candidate : null
      if (block) {
        if (block.type === 'comment') {
          position = block.to
          continue
        }
        const header = bibEntryHeaderAt(text, block.from)
        // Keep incomplete @commands as error rows; never silently discard
        // source text that Lezer recognized as an entry.
        if (!header) {
          items.push(...parseImportBlock(text.slice(block.from, block.to)))
          position = block.to
          continue
        }
        let entryEnd = block.to
        const original = text.slice(block.from, entryEnd)
        if (!block.closed) {
          // A standalone DOI line is another import item, even when the
          // preceding entry never closed. Do not split balanced entries here.
          for (let cursor = 0; cursor < original.length;) {
            const lineEnd = physicalLineEnd(original, cursor)
            if (cursor > 0 && isDoiLine(original.slice(cursor, lineEnd))) {
              entryEnd = block.from + cursor
              break
            }
            cursor = consumeOneNewline(original, lineEnd)
          }
        }
        const raw = text.slice(block.from, entryEnd)
        const trusted = canReuse && !invalid.has(block.from)
          ? completeImportEntry(text, entries.get(block.from), block.from, entryEnd)
          : null
        if (trusted) items.push({ kind: 'bibtex', entry: trusted, raw })
        else items.push(...parseImportBlock(raw))
        if (entryEnd < block.to) {
          // A DOI split an unclosed entry. Reparse the remainder because Lezer
          // may have absorbed subsequent entries into that malformed value.
          blocks = findSyntaxSourceBlocks(text.slice(entryEnd)).map(item => ({
            ...item, from: item.from + entryEnd, to: item.to + entryEnd,
          }))
          blockIndex = 0
          canReuse = false
        }
        position = entryEnd
        continue
      }
      items.push(trimmed.startsWith('@')
        ? { kind: 'error', raw: line, error: 'could_not_parse_this_reference', syntaxError: true }
        : { kind: 'error', raw: line })
    }
    position = consumeOneNewline(text, end)
  }

  return items
}

function parseImportBlock(block: string): BibImportItem[] {
  // Diagnose the original source before asking upstream to parse it.
  // Invalid citation keys are normalized only for importable entries.
  const syntax = analyzeBibSyntax(block)
  const diagnostics = validateBibSource(block, syntax).filter(
    item => item.code !== 'citation_key_contains_invalid_characters'
  )
  if (diagnostics.length > 0) {
    return [{
      kind: 'error',
      raw: block,
      errors: diagnostics,
      syntaxError: true,
    }]
  }

  // Diagnosed source is non-importable; strict Lezer completeness is checked
  // below as well, since diagnostics alone cannot guarantee safe serialization.
  const header = bibEntryHeaderAt(block, block.indexOf('@'))
  if (header && NON_BIBLIOGRAPHY_ENTRY_TYPES.has(header.type)) return []

  // A partial upstream accumulation is not safe to serialize. Require one
  // complete, error-free entry occupying the whole block, not merely a
  // diagnostic-free source or a non-null parser result.
  const entry = parseCompleteImportEntry(block, syntax)
  if (!entry) {
    return [{
      kind: 'error', raw: block,
      error: 'could_not_parse_this_reference', syntaxError: true,
    }]
  }
  return [{ kind: 'bibtex', entry, raw: block }]
}

/** An upstream entry must cover all non-trivia input and have trusted fields. */
function parseCompleteImportEntry(
  source: string,
  projection: BibSyntaxProjection = findSyntaxEntryProjection(source)
): BibtexEntry | null {
  if (projection.needsRecovery || projection.entries.length !== 1) return null
  return completeImportEntry(source, projection.entries[0], 0, source.length)
}

/** Validate one already-projected occurrence without another Lezer parse. */
function completeImportEntry(
  source: string,
  node: BibSyntaxEntryProjection | undefined,
  from: number,
  to: number
): BibtexEntry | null {
  if (!node || node.from !== from || !node.clean || !node.closed || !node.entry ||
    !node.citationKey || node.citationKey.from === node.citationKey.to ||
    node.entry.key !== source.slice(node.citationKey.from, node.citationKey.to) ||
    (node.to !== to && skipBibtexTrivia(source, node.to) !== to)) return null
  return node.entry
}

export type BibImportRow = {
  rowId: string
  status: 'ok' | 'doi-ok' | 'error' | 'empty'
  raw: string
  entry: BibtexEntry | null
  error?: string
  errors?: BibSourceDiagnostic[]
  heading: string
  title: string
  typeLabel: string
  syntaxError?: boolean
}

/** Build one import row without rebuilding unrelated rows. */
export function buildImportRow(
  item: BibImportItem,
  rowIndex: number,
  doiResult: string | BibtexEntry | undefined
): BibImportRow {
  const base: BibImportRow = {
    rowId: `import-${rowIndex}`,
    status: 'ok',
    raw: 'raw' in item ? item.raw : '',
    entry: null,
    heading: '',
    title: '',
    typeLabel: '',
  }

  switch (item.kind) {
    case 'bibtex':
    case 'doi': {
      if (item.kind === 'doi') {
        if (doiResult === undefined) {
          return { ...base, status: 'empty', raw: item.raw }
        }
        if (typeof doiResult === 'string') {
          return { ...base, status: 'error', raw: item.raw, error: doiResult }
        }
      }

      const sourceEntry = item.kind === 'bibtex' ? item.entry : doiResult as BibtexEntry
      const entry = prepareImportedEntry(sourceEntry)
      const raw = item.kind === 'bibtex'
        ? `@${(entry ?? sourceEntry).type}{${(entry ?? sourceEntry).key}`
        : item.raw
      if (!entry) {
        return { ...base, status: 'error', raw: item.kind === 'bibtex' ? item.raw : raw,
          error: 'could_not_repair_this_reference' }
      }
      return {
        ...base,
        status: item.kind === 'bibtex' ? 'ok' : 'doi-ok',
        raw,
        entry,
        heading: humanizeCitationHeading(entry),
        title: entry.getField('title').toDisplayString().trim(),
        typeLabel: entry.type,
      }
    }
    case 'error': {
      // Keep syntax-invalid rows non-importable. Show fields that the upstream
      // streaming parser can recover, without repairing the original source.
      const entry = item.syntaxError ? recoverSyntaxErrorEntry(item.raw) : null
      return {
        ...base,
        status: 'error',
        raw: item.raw,
        entry,
        heading: entry ? humanizeCitationHeading(entry) : '',
        title: entry?.getField('title').toDisplayString().trim() ?? '',
        typeLabel: entry?.type ?? '',
        error: item.error ?? 'could_not_parse_this_reference',
        errors: item.errors,
        syntaxError: item.syntaxError,
      }
    }
  }
}

function recoverSyntaxErrorEntry(raw: string): BibtexEntry | null {
  try {
    return parseBibFile(raw)[0]?.entry ?? null
  } catch {
    // Error rows must remain visible even when malformed syntax defeats recovery.
    return null
  }
}

export function buildImportRows(
  items: BibImportItem[],
  doiResults: (string | BibtexEntry | undefined)[]
): BibImportRow[] {
  let doiIndex = 0
  return items.map((item, rowIndex) => {
    const result = item.kind === 'doi' ? doiResults[doiIndex++] : undefined
    return buildImportRow(item, rowIndex, result)
  })
}

/**
 * Prepare one parsed entry for import. Upstream has already parsed valid BibTeX syntax. This final pass makes
 * the entry serializable by ensuring a
 * valid citation key. Required fields are deliberately not checked here: an
 * incomplete but syntactically valid entry is still useful and can be fixed after
 * import. Duplicate keys are equally valid in this visual editor.
 */
function prepareImportedEntry(entry: BibtexEntry): BibtexEntry | null {
  let key = entry.key.trim()
  if (!BIBTEX_CITATION_KEY_REGEX.test(key)) {
    key = Array.from(key)
      .filter(char => BIBTEX_CITATION_KEY_REGEX.test(char))
      .join('')
  }
  if (!key) {
    key = generatedKey(entry, 'imported')
  }
  if (key.length > MAX_KEY_LENGTH) {
    key = key.slice(0, MAX_KEY_LENGTH)
  }

  const normalised = entry.setKey(key)
  // This round trip is necessary even for a Lezer-clean source: upstream
  // represents a quoted literal as a braced literal when serializing. For
  // example, note="a}b" is valid but serializes as note={a}b}, which changes
  // the structure. It also rejects invalid DOI-generated field names/types.
  const reparsed = parseCompleteImportEntry(normalised.toString())
  if (!reparsed || reparsed.type !== normalised.type ||
    reparsed.key !== normalised.key ||
    reparsed.fields.size !== normalised.fields.size) return null
  for (const [name, value] of normalised.fields) {
    if (!reparsed.hasField(name) || reparsed.getField(name).toString() !== value.toString()) {
      return null
    }
  }
  return reparsed
}

const MAX_KEY_LENGTH = 128

function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && BIBTEX_CITATION_KEY_REGEX.test(key)
}

/** Generate a valid fallback key for pasted entries. */
function generatedKey(entry: BibtexEntry, fallback: string): string {
  const key = generateCitationKey(entry).slice(0, MAX_KEY_LENGTH)
  return isValidKey(key) ? key : fallback
}
