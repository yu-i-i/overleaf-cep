/**
 * Source diagnostics based on upstream Lezer syntax and field ranges.
 * Empty citation keys are supported in the visual editor. Only semantic checks
 * that Lezer does not perform (invalid keys and duplicate fields) live here.
 */
import { NON_BIBLIOGRAPHY_ENTRY_TYPES } from './bib-constants'
import { bibEntryHeaderAt, bibCitationKeyRange, bibtexIdentifierEnd } from './bib-source-scanner'
import { findSyntaxSourceBlocksWithIssues } from './bib-syntax-ranges'
import type { BibSyntaxSourceBlock, BibSyntaxSourceIssue } from './bib-syntax-ranges'
import { BIBTEX_CITATION_KEY_REGEX } from '@shared/bibtex/bibtex-identifier.mts'

export type BibSourceDiagnostic = {
  from: number
  entryFrom?: number
  line: number
  code: string
  field?: string
  relatedFrom?: number
  relatedLine?: number
}

/**
 * Report semantic errors and Lezer syntax issues in source-offset order.
 * `syntax` may be reused from an existing projection of `source` to avoid
 * parsing twice. Offsets use UTF-16 positions; line numbers are 1-based.
 */
export function validateBibSource(
  source: string,
  syntax: { blocks: BibSyntaxSourceBlock[]; issues: BibSyntaxSourceIssue[] } =
    findSyntaxSourceBlocksWithIssues(source)
): BibSourceDiagnostic[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\r') {
      if (source[i + 1] === '\n') i++
      starts.push(i + 1)
    } else if (source[i] === '\n') {
      starts.push(i + 1)
    }
  }
  const lineAt = (offset: number): number => {
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (starts[middle] <= offset) low = middle + 1
      else high = middle
    }
    return low
  }

  const diagnostics: BibSourceDiagnostic[] = []
  const add = (from: number, code: string, entryFrom: number,
    field?: string, relatedFrom?: number) => {
    diagnostics.push({
      from, code, entryFrom, field, relatedFrom, line: lineAt(from),
      relatedLine: relatedFrom === undefined ? undefined : lineAt(relatedFrom),
    })
  }

  for (const block of syntax.blocks) {
    if (NON_BIBLIOGRAPHY_ENTRY_TYPES.has(block.type)) continue
    const header = bibEntryHeaderAt(source, block.from)
    const keyRange = block.citationKey ?? (header && bibCitationKeyRange(source, header))
    if (keyRange) {
      const key = source.slice(keyRange.from, keyRange.to)
      if (key && !BIBTEX_CITATION_KEY_REGEX.test(key)) {
        add(keyRange.from, 'citation_key_contains_invalid_characters', block.from)
      }
    }

    // Duplicate fields are syntactically legal to Lezer but invalid for the
    // visual editor. The Lezer-provided ranges also cover valid keyless entries.
    const seen = new Set<string>()
    for (const field of block.fields ?? []) {
      if (seen.has(field.name)) {
        add(field.fieldFrom, 'bib_syntax_duplicate_field', block.from,
          source.slice(field.fieldFrom,
            bibtexIdentifierEnd(source, field.fieldFrom) ?? field.fieldFrom))
      }
      seen.add(field.name)
    }
  }

  // A semantic error must not suppress an unrelated Lezer syntax error.
  for (const issue of syntax.issues) {
    add(issue.from, issue.code, issue.entryFrom, issue.field, issue.relatedFrom)
  }
  return diagnostics.sort((a, b) => a.from - b.from)
}
