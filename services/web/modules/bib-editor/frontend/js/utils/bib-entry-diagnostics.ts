import type { BibSourceDiagnostic } from './bib-source-diagnostics'
import type { TFunction } from 'i18next'
import type { PositionedBibtexEntry } from '@/features/bibtex/positioned-bibtex-entry'

// Keep diagnostics alongside the positioned projection without extending the
// upstream entry type. WeakMap entries follow the lifetime of their projection.
const diagnosticsByEntry = new WeakMap<PositionedBibtexEntry, BibSourceDiagnostic[]>()
const EMPTY_DIAGNOSTICS: BibSourceDiagnostic[] = []

export function getBibEntryDiagnostics(
  entry: PositionedBibtexEntry
): BibSourceDiagnostic[] {
  return diagnosticsByEntry.get(entry) ?? EMPTY_DIAGNOSTICS
}

export function setBibEntryDiagnostics(
  entry: PositionedBibtexEntry,
  diagnostics: BibSourceDiagnostic[]
): void {
  if (diagnostics.length) {
    diagnosticsByEntry.set(entry, diagnostics)
  } else {
    diagnosticsByEntry.delete(entry)
  }
}

export function translateBibSourceDiagnostic(
  diagnostic: BibSourceDiagnostic,
  t: TFunction
): string {
  return t('bib_syntax_line', {
    line: diagnostic.line,
    problem: t(diagnostic.code, {
      field: diagnostic.field ?? '',
      line: diagnostic.relatedLine ?? diagnostic.line,
    }),
  })
}
