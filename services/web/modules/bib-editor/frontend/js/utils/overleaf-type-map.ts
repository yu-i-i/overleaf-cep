import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { BibtexFieldValue } from '@shared/bibtex/bibtex-field-value.mts'
import { BibtexName } from '@shared/bibtex/bibtex-name.mts'
import { isBracedAuthor, splitBibtexAnd } from './bib-author-names'
import type { BibEntryType } from '@shared/bibtex/bibtex-entry-schema.mts'
import { fieldLabel } from './bib-field-labels'

/** Labels and grouping for fields offered by the Add-field combobox. */

interface FieldTaxonomyGroup {
  label: string
  fields: { label: string; field: string }[]
}

/**
 * Optional-field groups and their display order. Labels come from fieldLabel()
 * so the form and the Add-field menu cannot disagree about a field's name.
 */
const OPTIONAL_FIELD_GROUPS: readonly { label: string; fields: readonly string[] }[] = [
  {
    label: 'Common',
    fields: [
      'abstract', 'subtitle', 'titleaddon', 'language', 'note', 'addendum',
      'pubstate',
    ],
  },
  {
    label: 'Contributors',
    fields: [
      'editor', 'editora', 'editorb', 'editorc', 'translator', 'annotator',
      'commentator', 'introduction', 'foreword', 'afterword', 'bookauthor',
      'holder',
    ],
  },
  {
    label: 'Books and volumes',
    fields: [
      'maintitle', 'mainsubtitle', 'maintitleaddon', 'booktitle', 'booksubtitle',
      'booktitleaddon', 'volume', 'volumes', 'part', 'edition', 'chapter',
      'pages', 'pagetotal', 'eid',
    ],
  },
  {
    label: 'Periodicals and journals',
    fields: [
      'journaltitle', 'journalsubtitle', 'journaltitleaddon', 'issuetitle',
      'issuesubtitle', 'issuetitleaddon', 'issue',
    ],
  },
  {
    label: 'Events and conferences',
    fields: [
      'eventtitle', 'eventtitleaddon', 'eventdate', 'venue',
    ],
  },
  {
    label: 'Publication details',
    fields: [
      'publisher', 'location', 'organization', 'institution', 'series', 'number',
      'type', 'version', 'month', 'isbn', 'issn', 'isrn', 'howpublished',
    ],
  },
  {
    label: 'Digital and online',
    fields: [
      'doi', 'eprint', 'eprintclass', 'eprinttype', 'url', 'urldate',
    ],
  },
  {
    label: 'Language and origin',
    fields: [
      'origlanguage',
    ],
  },
]

export const OPTIONAL_FIELD_TAXONOMY: readonly FieldTaxonomyGroup[] =
  OPTIONAL_FIELD_GROUPS.map(({ label, fields }) => ({
    label,
    fields: fields.map(field => ({ label: fieldLabel(field), field })),
  }))

/** Field names represented by the shared optional-field taxonomy. */
export const OPTIONAL_FIELD_NAMES: ReadonlySet<string> = new Set(
  OPTIONAL_FIELD_TAXONOMY.flatMap(group =>
    group.fields.map(field => field.field)
  )
)

/** Normalize required-field alternatives once for both labels and validation. */
export function requiredFieldGroups(
  entryType: Pick<BibEntryType, 'requiredFields'>
): string[][] {
  return entryType.requiredFields.map(field =>
    Array.isArray(field) ? field : [field]
  )
}

export function requiredFieldNames(
  entryType: Pick<BibEntryType, 'requiredFields'>
): string[] {
  return requiredFieldGroups(entryType).flat()
}

/**
 * Prefer upstream name parsing for ordinary author/editor lists. Its display
 * conversion removes braces before splitting on `and`, so a protected name
 * needs the editor's brace-aware splitter instead.
 */
export function citationAuthorSurnames(entry: BibtexEntry): {
  surnames: string[]
  hasOthers: boolean
} {
  const raw =
    entry.getField('author').toEditableString().trim() ||
    entry.getField('editor').toEditableString().trim()

  if (!raw.includes('{') && !raw.includes('}')) {
    const { names, hasOthers } = entry.getAuthors()
    return { surnames: names.map(name => name.toLast()).filter(Boolean), hasOthers }
  }

  // Upstream getAuthors() cannot distinguish an internal protected `and`
  // from an author separator after braces have been removed for display.
  const authors = splitBibtexAnd(raw)
  const hasOthers =
    authors.length > 1 && authors[authors.length - 1].toLowerCase() === 'others'
  const names = hasOthers ? authors.slice(0, -1) : authors
  return {
    surnames: names.map(name => {
      const display = BibtexFieldValue.fromEditableString(name).toDisplayString()
      return isBracedAuthor(name)
        ? display
        : new BibtexName(display).toLast()
    }).filter(Boolean),
    hasOthers,
  }
}

/** Build a compact citation heading from author/editor names and year. */
export function humanizeCitationHeading(entry: BibtexEntry): string {
  const { surnames, hasOthers } = citationAuthorSurnames(entry)
  const first = surnames[0] || ''
  let who = entry.key.trim()
  if (surnames.length === 1 && !hasOthers) {
    who = first || who
  } else if (surnames.length === 2 && !hasOthers) {
    who = `${first} & ${surnames[1]}`
  } else if (surnames.length > 0) {
    who = `${first} et al.`
  }
  const year = entry.getYear().trim()
  return year ? `${who} (${year})` : who
}

/** Offer all taxonomy fields except the entry type's regular and required fields. */
export function offeredOptionalFields(
  entryType: Pick<BibEntryType, 'fields' | 'requiredFields'>
): string[] {
  const excluded = new Set([
    ...entryType.fields.map(field => field.toLowerCase()),
    ...requiredFieldNames(entryType).map(field => field.toLowerCase()),
  ])
  return [...OPTIONAL_FIELD_NAMES].filter(field => !excluded.has(field))
}
