/**
 * Source ranges obtained from Overleaf's own Lezer BibTeX grammar.
 *
 * Every top-level Lezer Entry supplies a boundary, even when incomplete.
 * Only complete, error-free nodes provide trusted fields and entry content.
 */
import { parser as bibtexParser } from '@/features/source-editor/lezer-bibtex/bibtex.mjs'
import { Entry } from '@/features/source-editor/lezer-bibtex/bibtex.terms.mjs'
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common'
import { BibtexEntryAccumulator } from '@/features/bibtex/bibtex-parser'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { bibEntryHeaderAt, bibCitationKeyRange, bibMissingKeyCommaRange, bibtexIdentifierEnd, skipBibtexTrivia } from './bib-source-scanner'
import { BIBTEX_CITATION_KEY_REGEX } from '@shared/bibtex/bibtex-identifier.mts'


type BibSyntaxRange = { from: number; to: number }

export type BibFieldSourceRange = {
  name: string
  fieldFrom: number
  valueFrom: number
  valueTo: number
}

type BibSyntaxEntryRange = BibSyntaxRange & {
  /** Completed Lezer fields; trusted for writes only when the entry is clean. */
  fields: BibFieldSourceRange[]
}

/** One upstream entry and its exact source fields, obtained from one Lezer tree. */
export type BibSyntaxEntryProjection = BibSyntaxEntryRange & {
  type: string
  entry: BibtexEntry | null
  /** Exact upstream CitationKey token, when the grammar recognized one. */
  citationKey: { from: number; to: number } | null
  /** Real outer closing delimiter, even when the entry has syntax errors. */
  closed: boolean
  /** No syntax errors or incomplete field values: safe for source field edits. */
  clean: boolean
}

export type BibSyntaxProjection = {
  entries: BibSyntaxEntryProjection[]
  /** True if any upstream Entry was malformed. */
  needsRecovery: boolean
  /** Start of every top-level BibTeX directive (excluding Junk and % comments). */
  blockStarts: number[]
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node)
  for (let child = node.firstChild; child; child = child.nextSibling) {
    walk(child, visit)
  }
}

function childNamed(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === name) return child
  }
  return null
}

function hasRealEntryCloser(entry: SyntaxNode): boolean {
  const body = childNamed(entry, 'EntryBody')
  if (!body) return false
  const closer = childNamed(body, 'BodyClose')
  return !!closer && closer.from < closer.to && closer.to === entry.to
}

function hasRealValueClosers(value: SyntaxNode): boolean {
  let complete = true
  walk(value, node => {
    if (node.type.name !== 'StringLiteral') return
    const open = childNamed(node, 'StringOpen')
    const close = childNamed(node, 'StringClose')
    if (!open || !close || open.from >= open.to || close.from >= close.to) {
      complete = false
    }
  })
  return complete
}

function fieldsInEntry(source: string, entry: SyntaxNode): {
  fields: BibFieldSourceRange[]
  citationKey: { from: number; to: number } | null
  clean: boolean
} | null {
  const fields: BibFieldSourceRange[] = []
  let complete = true
  let clean = true
  let citationKey: { from: number; to: number } | null = null
  walk(entry, node => {
    if (node.type.isError) clean = false
    if (node.type.name === 'CitationKey') {
      citationKey = { from: node.from, to: node.to }
    }
    if (node.type.name !== 'Field') return
    const nameNode = childNamed(node, 'FieldName')
    const valueNode = childNamed(node, 'Value')
    if (!nameNode || !valueNode || !hasRealValueClosers(valueNode)) {
      complete = false
      return
    }
    fields.push({
      name: source.slice(nameNode.from, nameNode.to).toLowerCase(),
      fieldFrom: node.from,
      valueFrom: valueNode.from,
      valueTo: valueNode.to,
    })
  })
  // Keep complete field nodes for diagnostics even if a later field is malformed.
  return { fields, citationKey, clean: clean && complete }
}

/** Top-level BibTeX directives delimit incomplete entries. Junk remains part
 * of its preceding malformed entry; standalone % comments are source trivia. */
function topLevelBoundary(node: SyntaxNode): boolean {
  return node.type.name === 'Entry' ||
    node.type.name === 'CommentEntry' || node.type.name === 'StringEntry' ||
    node.type.name === 'PreambleEntry'
}

/** Build one occurrence directly from Lezer, preserving duplicate citation keys. */
function accumulateSyntaxEntry(source: string, entryNode: SyntaxNode): BibtexEntry | null {
  const accumulator = new BibtexEntryAccumulator()
  accumulator.reset()

  const visit = (node: SyntaxNode): void => {
    const ref = { type: node.type, from: node.from, to: node.to } as SyntaxNodeRef
    const descend = accumulator.enter(ref, (from: number, to: number) => source.slice(from, to))
    if (descend !== false) {
      for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
    }
    accumulator.leave(ref)
  }

  visit(entryNode)
  return accumulator.build()
}

/**
 * Parse the document once and retain each accepted Entry node together with its
 * exact source and field ranges. Accumulate the entry once, so consumers do
 * not need the Lezer node or an isolated reparsing step.
 */
function projectSyntaxEntries(
  source: string,
  includeEntries: boolean,
  tree: Tree
): BibSyntaxProjection {
  const entries: BibSyntaxEntryProjection[] = []
  let incomplete = false
  const blockStarts: number[] = []

  // Lezer already identifies entry starts, including malformed entries that
  // end at an error token and leave the rest of their text in a Junk node.
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (topLevelBoundary(node)) blockStarts.push(node.from)
    if (!node.type.is(Entry)) continue
    const closed = hasRealEntryCloser(node)
    const result = fieldsInEntry(source, node)
    const clean = closed && !!result?.clean
    if (!clean) incomplete = true
    const typeNode = node.firstChild && childNamed(node.firstChild, 'EntryType')
    entries.push({
      type: typeNode ? source.slice(typeNode.from, typeNode.to).toLowerCase() : 'misc',
      from: node.from,
      to: node.to,
      fields: result?.fields ?? [],
      citationKey: result?.citationKey ?? null,
      closed,
      clean,
      entry: includeEntries ? accumulateSyntaxEntry(source, node) : null,
    })
  }

  return { entries, needsRecovery: incomplete, blockStarts }
}

/** Independently project entries from one upstream tree. */
export function findSyntaxEntryProjection(
  source: string,
  includeEntries = true
): BibSyntaxProjection {
  return projectSyntaxEntries(source, includeEntries, bibtexParser.parse(source))
}

/** Top-level blocks and Lezer syntax errors, from the same syntax tree.
 * These errors describe entries, not comments or arbitrary Junk between entries.
 * A valid empty citation key is explicitly supported by the visual editor.
 */
export type BibSyntaxSourceBlock = {
  from: number
  to: number
  type: string
  /** True only when Lezer found the real outer closer. */
  closed?: boolean
  /** Completed Lezer Field nodes for diagnostics; not trusted write ranges. */
  fields?: BibFieldSourceRange[]
  citationKey?: { from: number; to: number } | null
}
export type BibSyntaxSourceIssue = {
  from: number
  entryFrom: number
  code: 'bib_syntax_invalid_entry_header' | 'bib_syntax_invalid_field' |
    'bib_syntax_missing_closing_quote' | 'bib_syntax_missing_closing_brace_opened_on_line' |
    'bib_syntax_expected_equals_after_field_name' | 'bib_syntax_expected_comma_before_field' |
    'bib_syntax_expected_comma_after_citation_key' | 'bib_syntax_unexpected_comma'
  field?: string
  relatedFrom?: number
}

function firstSyntaxError(node: SyntaxNode): number | null {
  if (node.type.isError) return node.from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const error = firstSyntaxError(child)
    if (error !== null) return error
  }
  return null
}

/** Classify simple separator errors using Lezer's error position.
 * Do not reconstruct fields or parse Junk after a syntax error. */
function fieldSeparatorIssue(
  entry: SyntaxNode, source: string, errorFrom: number
): Pick<BibSyntaxSourceIssue, 'code' | 'field'> | null {
  const body = childNamed(entry, 'EntryBody')
  if (!body) return null
  const header = bibEntryHeaderAt(source, entry.from)
  const missingKeyComma = header && bibMissingKeyCommaRange(source, header)
  if (missingKeyComma && missingKeyComma.to <= errorFrom) {
    return { code: 'bib_syntax_expected_comma_after_citation_key',
      field: missingKeyComma.field }
  }
  let previous: SyntaxNode | null = null
  for (let node = body.firstChild; node; node = node.nextSibling) {
    if (node.type.isError && node.from === errorFrom && source[node.from] === ',' &&
      source.slice(body.from, node.from).trimEnd().endsWith(',')) {
      return { code: 'bib_syntax_unexpected_comma' }
    }
    if (node.type.name === 'Field' && firstSyntaxError(node) === errorFrom) {
      const name = childNamed(node, 'FieldName')
      if (name && !childNamed(node, '=')) {
        return { code: 'bib_syntax_expected_equals_after_field_name',
          field: source.slice(name.from, name.to) }
      }
    }
    if (node.type.isError && node.from === errorFrom &&
      previous?.type.name === 'Field' && childNamed(previous, 'Value')) {
      const next = skipBibtexTrivia(source, errorFrom)
      const end = bibtexIdentifierEnd(source, next)
      if (end !== null && source[skipBibtexTrivia(source, end)] === '=') {
        return { code: 'bib_syntax_expected_comma_before_field',
          field: source.slice(next, end) }
      }
    }
    previous = node
  }
  return null
}

/** Lezer cannot continue after a missing or invalid key. Supply a temporary
 * valid key for diagnostic projection, without changing the source.
 * All returned coordinates refer to the original source.
 */
function virtualKeylessEntry(source: string, recoverInvalidKey = false): {
  source: string
  shift: (offset: number) => number
  keyRange: { from: number; to: number }
} | null {
  const header = bibEntryHeaderAt(source, 0)
  const range = header && bibCitationKeyRange(source, header)
  if (!range || (range.from !== range.to &&
    (!recoverInvalidKey || BIBTEX_CITATION_KEY_REGEX.test(source.slice(range.from, range.to))))) return null

  const key = 'BibEditorTemporaryKey'
  const delta = key.length - (range.to - range.from)
  return {
    source: source.slice(0, range.from) + key + source.slice(range.to),
    keyRange: range,
    shift: offset => offset >= range.from + key.length
      ? offset - delta : Math.min(offset, range.from),
  }
}

/** The shared keyless projection for diagnostics and field edits; optionally
 * recover invalid keys for diagnostics too. The temporary key stays in memory.
 */
function projectVirtualKeylessEntry(
  source: string, includeEntry = false, recoverInvalidKey = false
):
  | {
    clean: true
    fields: BibFieldSourceRange[]
    keyRange: { from: number; to: number }
    close: number
    entry: BibtexEntry | null
  }
  | { clean: false; errorFrom: number; fields: BibFieldSourceRange[]
    unclosed: ReturnType<typeof missingStringClose>
    separator: ReturnType<typeof fieldSeparatorIssue> }
  | null {
  const virtual = virtualKeylessEntry(source, recoverInvalidKey)
  if (!virtual) return null

  const tree = bibtexParser.parse(virtual.source)
  const node = tree.topNode.firstChild
  const error = node?.type.is(Entry) ? firstSyntaxError(node) : null
  const unclosed = node?.type.is(Entry) ? missingStringClose(node, virtual.source) : null
  const invalid = (from: number) => ({
    clean: false as const,
    errorFrom: virtual.shift(from),
    // Completed upstream fields before the error are useful for diagnostics,
    // but must never be used as trusted editing ranges.
    fields: node?.type.is(Entry) ? (fieldsInEntry(virtual.source, node)?.fields ?? []).map(field => ({
      ...field,
      fieldFrom: virtual.shift(field.fieldFrom),
      valueFrom: virtual.shift(field.valueFrom),
      valueTo: virtual.shift(field.valueTo),
    })) : [],
    unclosed: unclosed && { ...unclosed, relatedFrom: virtual.shift(unclosed.relatedFrom) },
    separator: node?.type.is(Entry) && error !== null
      ? fieldSeparatorIssue(node, virtual.source, error) : null,
  })
  // Standalone % comments after a complete entry are trivia, not part of it.
  // They can follow the entry in Lezer's top-level tree without invalidating it.
  let trailing = node?.nextSibling
  while (trailing?.type.name === 'Comment') trailing = trailing.nextSibling
  if (!node || !node.type.is(Entry) || trailing || node.from !== 0 ||
    !hasRealEntryCloser(node) || error !== null) {
    return invalid(error ?? (node?.to ?? virtual.source.length))
  }

  const fields = fieldsInEntry(virtual.source, node)
  if (!fields?.clean) return invalid(node.to)
  const entry = includeEntry ? accumulateSyntaxEntry(virtual.source, node) : null
  if (includeEntry && !entry) return invalid(node.to)
  return {
    clean: true,
    keyRange: virtual.keyRange,
    close: virtual.shift(node.to - 1),
    entry: entry?.setKey('') ?? null,
    fields: fields.fields.map(field => ({
      ...field,
      fieldFrom: virtual.shift(field.fieldFrom),
      valueFrom: virtual.shift(field.valueFrom),
      valueTo: virtual.shift(field.valueTo),
    })),
  }
}

/** Detect an unclosed string directly from Lezer's StringOpen/StringClose nodes.
 * No independent quote or brace state machine is needed. */
function missingStringClose(entry: SyntaxNode, source: string): {
  code: 'bib_syntax_missing_closing_quote' | 'bib_syntax_missing_closing_brace_opened_on_line'
  relatedFrom: number
} | null {
  let missing: ReturnType<typeof missingStringClose> = null
  walk(entry, node => {
    if (node.type.name !== 'StringLiteral' || childNamed(node, 'StringClose')) return
    const open = childNamed(node, 'StringOpen')
    if (open) {
      missing = {
        code: source[open.from] === '"'
          ? 'bib_syntax_missing_closing_quote'
          : 'bib_syntax_missing_closing_brace_opened_on_line',
        relatedFrom: open.from,
      }
    }
  })
  return missing
}

function collectSourceBlocks(
  source: string,
  includeIssues: boolean,
  tree: Tree,
  projectedEntries?: Map<number, BibSyntaxEntryProjection>
): {
  blocks: BibSyntaxSourceBlock[]
  issues: BibSyntaxSourceIssue[]
} {
  const nodes: SyntaxNode[] = []
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (topLevelBoundary(node)) {
      nodes.push(node)
    }
  }
  const blocks: BibSyntaxSourceBlock[] = []
  const issues: BibSyntaxSourceIssue[] = []
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    const body = node.lastChild
    const closer = body && childNamed(body, 'BodyClose')
    const closed = !!closer && closer.from < closer.to && closer.to === node.to
    const typeNode = node.firstChild && childNamed(node.firstChild, 'EntryType')
    const type = node.type.name === 'Entry'
      ? (typeNode ? source.slice(typeNode.from, typeNode.to).toLowerCase() : '')
      : node.type.name.replace('Entry', '').toLowerCase()
    const to = closed ? node.to : (nodes[index + 1]?.from ?? source.length)
    // Lezer stops at an empty key. Use the shared virtual-key projection to
    // locate its real closer, including when a % comment follows the entry.
    const keyless = node.type.is(Entry) && !closed
      ? projectVirtualKeylessEntry(source.slice(node.from, to)) : null
    const block: BibSyntaxSourceBlock = {
      from: node.from,
      to: keyless?.clean ? node.from + keyless.close + 1 : to,
      type, closed: keyless?.clean || closed,
    }
    blocks.push(block)
    if (!includeIssues || !node.type.is(Entry)) continue

    // Lezer's completed Field nodes can still diagnose duplicates when a
    // later field is malformed. Do not use these ranges for source writes.
    const cached = projectedEntries?.get(node.from)
    // The combined projection has already collected complete field nodes,
    // including those preceding a syntax error. Do not walk them twice.
    const parsed = cached ?? fieldsInEntry(source, node)
    if (parsed) {
      block.fields = parsed.fields
      if (parsed.clean && closed) block.citationKey = parsed.citationKey
    }
    const header = bibEntryHeaderAt(source, node.from)
    if (!header) {
      issues.push({ from: node.from,
        entryFrom: node.from, code: 'bib_syntax_invalid_entry_header' })
      continue
    }
    let error = firstSyntaxError(node)
    if (error === null && closed) continue
    // A missing or invalid key stops Lezer before the body. Reparse with a
    // virtual key so the rest of the entry determines the syntax diagnosis.
    const diagnosticKeyless = keyless ??
      projectVirtualKeylessEntry(source.slice(node.from, to), false, true)
    if (diagnosticKeyless) {
      // Include fields Lezer recognized before the first malformed value.
      // These ranges are diagnostic-only; write planning requires a clean entry.
      block.fields = diagnosticKeyless.fields.map(field => ({
        ...field,
        fieldFrom: node.from + field.fieldFrom,
        valueFrom: node.from + field.valueFrom,
        valueTo: node.from + field.valueTo,
      }))
      if (diagnosticKeyless.clean) {
        block.to = node.from + diagnosticKeyless.close + 1
        block.citationKey = {
          from: node.from + diagnosticKeyless.keyRange.from,
          to: node.from + diagnosticKeyless.keyRange.to,
        }
        continue
      }
    }
    if (diagnosticKeyless && !diagnosticKeyless.clean) error = node.from + diagnosticKeyless.errorFrom
    const unclosed = diagnosticKeyless && !diagnosticKeyless.clean && diagnosticKeyless.unclosed
      ? { ...diagnosticKeyless.unclosed, relatedFrom: node.from + diagnosticKeyless.unclosed.relatedFrom }
      : missingStringClose(node, source)
    const separator = diagnosticKeyless && !diagnosticKeyless.clean
      ? diagnosticKeyless.separator : error !== null ? fieldSeparatorIssue(node, source, error) : null
    issues.push({ from: error ?? node.to, entryFrom: node.from,
      code: unclosed?.code ?? separator?.code ?? 'bib_syntax_invalid_field',
      field: separator?.field, relatedFrom: unclosed?.relatedFrom })
  }
  return { blocks, issues }
}

/** Include Lezer's syntax errors when validating input before an import.
 * In particular, a block can have well-formed delimiters but an invalid value.
 */
export function findSyntaxSourceBlocksWithIssues(source: string): {
  blocks: BibSyntaxSourceBlock[]
  issues: BibSyntaxSourceIssue[]
} {
  return collectSourceBlocks(source, true, bibtexParser.parse(source))
}

/** Top-level BibTeX blocks, including incomplete entries and @comment bodies.
 * Lezer owns discovery; malformed blocks extend up to the next upstream block.
 */
export function findSyntaxSourceBlocks(source: string): BibSyntaxSourceBlock[] {
  return collectSourceBlocks(source, false, bibtexParser.parse(source)).blocks
}

/** The complete upstream projection and syntax diagnostics from one grammar parse.
 * Import can share this result with its diagnostics and strict completeness
 * guard, instead of parsing the same candidate twice.
 */
export function analyzeBibSyntax(source: string): BibSyntaxProjection & {
  blocks: BibSyntaxSourceBlock[]
  issues: BibSyntaxSourceIssue[]
} {
  const tree = bibtexParser.parse(source)
  const projection = projectSyntaxEntries(source, true, tree)
  const entriesByStart = new Map(projection.entries.map(entry => [entry.from, entry]))
  return {
    ...projection,
    ...collectSourceBlocks(source, true, tree, entriesByStart),
  }
}

/**
 * Upstream Lezer cannot parse fields after an empty citation key. Project only
 * that single source occurrence through a temporary, valid key, without ever
 * writing the temporary text to CodeMirror. Every field offset is translated
 * back to the original text; malformed entries still fail closed.
 */
export function projectKeylessEntry(source: string): {
  entry: BibtexEntry
  fields: BibFieldSourceRange[]
  close: number
} | null {
  const projection = projectVirtualKeylessEntry(source, true)
  if (!projection?.clean || !projection.entry) return null
  return {
    entry: projection.entry,
    fields: projection.fields,
    close: projection.close,
  }
}

/** Trusted field ranges and real outer closer from one isolated Lezer parse.
 * Both editing positions come from the same syntax projection; the write planner
 * need not scan delimiters again. Keyless entries use the same virtual-key
 * projection as the Visual editor, with offsets mapped to the original text.
 */
export function findTrustedFieldSource(source: string): {
  fields: BibFieldSourceRange[]
  close: number
} | null {
  // Keyless entries need only the virtual-key parse. Do not first parse an
  // incomplete entry with the original grammar and then parse it again.
  const keyless = projectVirtualKeylessEntry(source)
  if (keyless) {
    return keyless.clean ? { fields: keyless.fields, close: keyless.close } : null
  }

  const projection = findSyntaxEntryProjection(source, false)
  if (projection.needsRecovery || projection.entries.length !== 1) return null
  const entry = projection.entries[0]
  return entry.from === 0 && entry.clean && entry.closed
    ? { fields: entry.fields, close: entry.to - 1 } : null
}

