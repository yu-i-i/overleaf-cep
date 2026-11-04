/**
 * Small source-text helpers for key edits and conservative write guards.
 * Entry boundaries, fields and syntax errors come from upstream Lezer.
 */

import {
  isBibtexIdentifierContinuationChar,
  isBibtexIdentifierStartChar,
} from '@shared/bibtex/bibtex-identifier.mts'

/** End of the physical line, before LF, CRLF or a lone CR. */
export function physicalLineEnd(source: string, index: number): number {
  while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
    index++
  }
  return index
}

/** Start of the physical line containing `index` (LF, CRLF and CR). */
export function physicalLineStart(source: string, index: number): number {
  let i = Math.min(index, source.length) - 1
  while (i >= 0 && source[i] !== '\n' && source[i] !== '\r') i--
  return i + 1
}

/** Skip a line comment, including its physical newline when present. */
export function skipLineComment(source: string, index: number): number {
  return consumeOneNewline(source, physicalLineEnd(source, index))
}

/** Skip whitespace and, at token boundaries, upstream-style `%` comments.
 * Call only between BibTeX tokens, never inside a braced or quoted value.
 */
export function skipBibtexTrivia(
  source: string,
  index: number,
  allowLineBreaks = true
): number {
  let i = index
  while (i < source.length) {
    if (source[i] === ' ' || source[i] === '\t' ||
      (allowLineBreaks && (source[i] === '\r' || source[i] === '\n'))) {
      i++
    } else if (allowLineBreaks && source[i] === '%') {
      i = skipLineComment(source, i)
    } else {
      break
    }
  }
  return i
}

/** Returns the end offset of an identifier in source or null. */
export function bibtexIdentifierEnd(source: string, start: number): number | null {
  if (!isBibtexIdentifierStartChar(source[start] ?? '')) return null
  let end = start + 1
  while (isBibtexIdentifierContinuationChar(source[end] ?? '')) end++
  return end
}


/** A parsed entry header, with offsets in the original source. */
export type BibEntryHeader = {
  type: string
  typeFrom: number
  typeTo: number
  opener: '{' | '('
  open: number
}

/**
 * Parse an entry header without copying the rest of the document. This helper is
 * intentionally index-based because it is called once per entry while walking a
 * complete bibliography; suffix slices there otherwise make many-entry files
 * quadratic in total source length.
 */
export function bibEntryHeaderAt(source: string, index: number): BibEntryHeader | null {
  if (source[index] !== '@') return null

  let i = skipBibtexTrivia(source, index + 1)
  const typeStart = i
  const typeEnd = bibtexIdentifierEnd(source, i)
  if (typeEnd === null) return null
  i = typeEnd
  const type = source.slice(typeStart, i).toLowerCase()

  i = skipBibtexTrivia(source, i)
  const opener = source[i]
  if (opener !== '{' && opener !== '(') return null

  return { type, typeFrom: typeStart, typeTo: typeEnd, opener, open: i }
}

/**
 * Source offsets of a citation key in a normally separated entry header.
 * Accepts a comma or the actual outer closing delimiter (key-only entries).
 * Incomplete and malformed headers without either separator are left to the
 * recovery paths; never search into a following entry for a comma.
 */
export function bibCitationKeyRange(
  source: string,
  header: Pick<BibEntryHeader, 'open' | 'opener'>
): { from: number; to: number } | null {
  // The key may follow whitespace and complete line comments. These are
  // header trivia, not part of the citation key or its editable source range.
  const from = skipBibtexTrivia(source, header.open + 1)

  const closer = header.opener === '{' ? '}' : ')'
  let end = from
  let keyEnd: number | null = null
  while (end < source.length) {
    const char = source[end]
    if (char === ',' || char === closer) {
      let to = keyEnd ?? end
      // Upstream admits Unicode spaces inside key identifiers, but after an
      // ASCII whitespace boundary, trailing Unicode whitespace is trivia.
      // Preserve malformed keys containing interior ASCII whitespace here:
      // they must remain editable so users can repair them in source mode.
      while (to > from && /[ \t\r\n]/.test(source[to - 1])) to--
      const candidate = source.slice(from, to)
      const boundary = candidate.search(/[ \t\r\n]/)
      if (boundary >= 0 && /^\s*$/.test(candidate.slice(boundary))) {
        to = from + boundary
      }
      return { from, to }
    }
    if (char === '%') {
      // An inline comment belongs to the header, but not to the key. Retain
      // its original offsets when replacing just the key in the source.
      keyEnd ??= end
      end = skipLineComment(source, end)
      continue
    }
    // After a comment, only whitespace and the separator may follow the key.
    if (keyEnd !== null && !/\s/.test(char)) return null
    // A nested value or another entry marker is not part of a normal key.
    if (char === '{' || char === '(' || char === '}' || char === ')' ||
      (char === '@' && isLikelyEntryStart(source, end))) {
      return null
    }
    end++
  }
  return null
}

/** Key followed by a field but missing the comma separating them. */
export function bibMissingKeyCommaRange(
  source: string,
  header: Pick<BibEntryHeader, 'open'>
): { from: number; to: number; field: string } | null {
  const from = skipBibtexTrivia(source, header.open + 1)
  let to = from
  while (to < source.length && !/[\s,{}()]/.test(source[to])) to++
  if (to === from || !/\s/.test(source[to] ?? '')) return null

  const next = skipBibtexTrivia(source, to)
  const nameEnd = bibtexIdentifierEnd(source, next)
  const field = nameEnd !== null &&
    source[skipBibtexTrivia(source, nameEnd, true)] === '='
    ? source.slice(next, nameEnd) : null
  return field ? { from, to, field } : null
}

/** Whether only horizontal whitespace precedes this position on its line. */
function isAtLineStart(source: string, index: number): boolean {
  let i = index - 1
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--
  return i < 0 || source[i] === '\n' || source[i] === '\r'
}

/** Recognize a possible entry marker at the beginning of a line. */
export function isLikelyEntryStart(source: string, index: number): boolean {
  return source[index] === '@' && isAtLineStart(source, index) &&
    bibEntryHeaderAt(source, index) !== null
}

/** Advance past one physical newline, preserving additional blank lines. */
export function consumeOneNewline(source: string, index: number): number {
  if (source.startsWith('\r\n', index)) return index + 2
  if (source[index] === '\n' || source[index] === '\r') return index + 1
  return index
}
