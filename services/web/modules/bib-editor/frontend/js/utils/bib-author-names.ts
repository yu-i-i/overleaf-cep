/** Whether braces enclose the complete author rather than only part of it. */
export function isBracedAuthor(value: string): boolean {
  if (!value.startsWith('{') || !value.endsWith('}')) return false
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '{') depth++
    if (value[i] === '}' && --depth === 0 && i !== value.length - 1) return false
  }
  return depth === 0
}

/**
 * Split authors conservatively on top-level `and`. This function is suitable for
 * valid source text; malformed per-author brace balancing is handled by the visual
 * author controls rather than repaired here. Braces preceded by backslashes
 * still affect nesting, matching the BibTeX source parser.
 */
export function splitBibtexAnd(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let braceDepth = 0
  let hasAuthorText = false
  const contentEnd = value.trimEnd().length

  const pushPart = (end: number) => {
    const part = value.slice(start, end).trim()
    if (part) parts.push(part)
    start = end
  }

  for (let i = 0; i < value.length; i++) {
    const char = value[i]

    // The field's outer quotes were already parsed by BibtexFieldValue.
    // Any quotes remaining here are literal author text, not delimiters.
    if (char === '{') {
      braceDepth++
      hasAuthorText = true
      continue
    }
    if (char === '}') {
      if (braceDepth > 0) braceDepth--
      hasAuthorText = true
      continue
    }

    if (
      char.toLowerCase() !== 'a' ||
      (i > 0 && !/\s/.test(value[i - 1] || ''))
    ) {
      if (!/\s/.test(char)) hasAuthorText = true
      continue
    }

    // Check the separator in place. Matching against `value.slice(i)` at every
    // word boundary repeatedly copied the remaining author string and could make
    // long names/author lists quadratic.
    const isAnd =
      value[i + 1]?.toLowerCase() === 'n' &&
      value[i + 2]?.toLowerCase() === 'd' &&
      (i + 3 === value.length || /\s/.test(value[i + 3]))
    // Only split when there is an author on both sides. A leading or
    // trailing 'and' is literal text, not a separator.
    if (!isAnd || braceDepth !== 0 || !hasAuthorText || i + 3 >= contentEnd) {
      hasAuthorText = true
      continue
    }

    pushPart(i)
    hasAuthorText = false
    i += 2
    start = i + 1
    while (start < value.length && /\s/.test(value[start])) start++
    i = start - 1
  }

  const last = value.slice(start).trim()
  if (last) parts.push(last)
  return parts.length > 0 ? parts : ['']
}
