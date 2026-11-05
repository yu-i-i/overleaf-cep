import { BibtexFieldValue } from '@shared/bibtex/bibtex-field-value.mts'

const STANDARD_MONTHS = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i

/** Follow upstream editable syntax: ## is a literal # and #name# a string reference. */
export function toBibFormString(
  value: BibtexFieldValue,
  fieldName?: string
): string {
  const editable = value.toEditableString()
  const month = editable.match(/^#([^#]+)#$/)
  if (fieldName === 'month' && month && STANDARD_MONTHS.test(month[1])) {
    return month[1]
  }
  return editable
}

export function fromBibFormString(
  value: string,
  fieldName?: string,
  previous?: BibtexFieldValue
): BibtexFieldValue {
  // An untouched field must not be reconstructed: the editable string does not
  // distinguish an upstream NumberLiteral from a braced numeric StringLiteral.
  if (previous && value === toBibFormString(previous, fieldName)) return previous

  // Preserve the source's numeric atom when a numeric atom is edited.
  if (previous && /^\d+$/.test(previous.toString()) && /^\d+$/.test(value)) {
    return new BibtexFieldValue().addNumber(value)
  }

  if (fieldName === 'month' && STANDARD_MONTHS.test(value.trim())) {
    return new BibtexFieldValue().addNamedString(value.trim())
  }
  return BibtexFieldValue.fromEditableString(value)
}

/** Upstream collapses line breaks inside literal atoms when parsing source. */
export function sameBibFormValue(editable: string, parsed: string): boolean {
  return editable.replaceAll(/[\r\n]\s*/g, ' ') ===
    parsed.replaceAll(/[\r\n]\s*/g, ' ')
}

/**
 * Preserve whitespace in the editable value of a complete BibTeX expression.
 * Upstream replaces newlines in literal atoms with spaces. Read those atoms
 * from the original source, but accept the result only when the normalized
 * editable spelling matches the upstream value. Unexpected syntax falls back
 * to upstream instead of guessing at source ranges.
 */
export function textareaValueFromSource(
  sourceValue: string,
  canonical: string
): string | null {
  let index = 0
  const exact: string[] = []

  const skipTrivia = () => {
    while (index < sourceValue.length) {
      if (/\s/.test(sourceValue[index])) {
        index++
      } else if (sourceValue[index] === '%') {
        while (index < sourceValue.length && !/[\r\n]/.test(sourceValue[index])) index++
      } else {
        break
      }
    }
  }

  while (true) {
    skipTrivia()
    if (index >= sourceValue.length) return null
    const opener = sourceValue[index]
    let part: string

    if (opener === '{' || opener === '"') {
      const start = ++index
      let depth = opener === '{' ? 1 : 0
      while (index < sourceValue.length) {
        const ch = sourceValue[index]
        if (ch === '{') depth++
        else if (ch === '}') {
          if (opener === '{' && --depth === 0) break
          if (opener === '"' && depth > 0) depth--
        } else if (ch === '"' && opener === '"' && depth === 0) break
        index++
      }
      if (index === sourceValue.length) return null
      const literal = sourceValue.slice(start, index++)
      part = literal.replaceAll('#', '##')
    } else {
      const start = index
      while (index < sourceValue.length && !/[\s#%,{}()"\r\n]/.test(sourceValue[index])) index++
      if (index === start) return null
      const token = sourceValue.slice(start, index)
      part = /^\d+$/.test(token) ? token : `#${token}#`
    }

    exact.push(part)
    skipTrivia()
    if (index >= sourceValue.length) break
    if (sourceValue[index++] !== '#') return null
  }

  const value = exact.join('').replaceAll(/\r\n|\r/g, '\n')
  return sameBibFormValue(value, canonical) ? value : null
}
