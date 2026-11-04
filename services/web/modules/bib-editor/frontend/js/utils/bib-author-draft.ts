import { hasBalancedCurlyBraces } from './bib-validate'
import { isBracedAuthor, splitBibtexAnd } from './bib-author-names'

export type BibAuthorRow = {
  value: string
  saved: string
}

/** A single editor state for both author input modes. */
export type BibAuthorDraft =
  | { mode: 'rows'; rows: BibAuthorRow[] }
  | { mode: 'text'; value: string; saved: string; invalidRow?: string }

export type BibNameDrafts = Partial<Record<string, BibAuthorDraft>>

export const MAX_AUTHOR_ROWS = 10

const joinAuthors = (values: string[]) =>
  values.filter(value => value.trim()).join(' and ')

const authorInputValue = (value: string) =>
  isBracedAuthor(value) ? value.slice(1, -1) : value

/** Preserve untouched names, but brace edited names only when needed. */
export function authorSourceValue(value: string, previous = ''): string {
  if (!value.trim()) return ''
  if (previous && value === authorInputValue(previous)) return previous
  return /\band(?:\s|$)/i.test(value) && !isBracedAuthor(value)
    ? `{${value}}`
    : value
}

export function createAuthorDraft(value: string): BibAuthorDraft {
  const authors = splitBibtexAnd(value).filter(author => author.trim())
  if (authors.length > MAX_AUTHOR_ROWS) {
    return { mode: 'text', value, saved: value }
  }
  return {
    mode: 'rows',
    rows: (authors.length ? authors : ['']).map(saved => ({
      value: authorInputValue(saved),
      saved,
    })),
  }
}

export function authorDraftValue(draft: BibAuthorDraft): string {
  return draft.mode === 'text'
    ? draft.value
    : joinAuthors(draft.rows.map(row => authorSourceValue(row.value, row.saved)))
}

export function authorDraftSavedValue(draft: BibAuthorDraft): string {
  return draft.mode === 'text'
    ? draft.saved
    : joinAuthors(draft.rows.map(row => row.saved))
}

export function isAuthorDraftValid(draft: BibAuthorDraft): boolean {
  return draft.mode === 'text'
    ? draft.invalidRow == null && hasBalancedCurlyBraces(draft.value)
    : draft.rows.every(row => hasBalancedCurlyBraces(row.value))
}
