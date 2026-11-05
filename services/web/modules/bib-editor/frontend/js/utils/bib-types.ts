/**
 * Visual-editor type model. This is the bridge between the raw BibTeX entry model
 * and the per-type field order/required-field rules used by the React forms.
 */
import { getEntryType, getTypeFields } from '@shared/bibtex/entry-types.mts'
import type { BibEntryType } from '@shared/bibtex/bibtex-entry-schema.mts'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { OPTIONAL_FIELD_NAMES, requiredFieldGroups, requiredFieldNames } from './overleaf-type-map.ts'

export type { PositionedBibtexEntry } from '@/features/bibtex/positioned-bibtex-entry'
export type { BibEntryType }

/** Field presentation. Unlisted fields use an ordinary one-line input. */
const FIELD_TYPES = new Map<string, 'name' | 'large'>([
  ['author', 'name'],
  ['editor', 'name'],
  ['title', 'large'],
  ['note', 'large'],
  ['keywords', 'large'],
  ['abstract', 'large'],
])

export const getFieldType = (field: string): 'name' | 'large' | 'short' =>
  FIELD_TYPES.get(field) ?? 'short'

export const NAME_FIELDS = [...FIELD_TYPES]
  .filter(([, type]) => type === 'name')
  .map(([field]) => field)

export const isNameField = (field: string): boolean =>
  getFieldType(field) === 'name'

/** A required field is missing when its value is empty, even if it exists. */
export function missingRequiredFieldGroups(entry: BibtexEntry): string[][] {
  return requiredFieldGroups(getEntryType(entry.type.toLowerCase()))
    .filter(group =>
      group.every(field => !entry.getField(field).toEditableString().trim())
    )
}

/** Return the field order defined by the shared BibTeX entry type. */
export function formRowsFor(type: string): string[] {
  return [...getTypeFields(type.toLowerCase())]
}

/**
 * Optional rows visible in the form are the union of fields already present in
 * the entry and fields explicitly added during this editing session. Keeping the
 * union here is important for malformed entries: a hidden field can still need to
 * be revealed when its value is invalid.
 */
export function optionalVisibleFor(
  type: string,
  entry: BibtexEntry,
  addedFields: string[] = []
): string[] {
  const typeDef = getEntryType(type.toLowerCase())

  const required = new Set(requiredFieldNames(typeDef).map(field => field.toLowerCase()))
  const formFields = new Set(typeDef.fields.map(field => field.toLowerCase()))
  const added = new Set(addedFields)
  const candidateFields = new Set([
    ...OPTIONAL_FIELD_NAMES,
    ...addedFields,
    ...entry.getFieldsArray().map(({ key }) => key.toLowerCase()),
  ])

  return [...candidateFields].filter(field => {
    if (formFields.has(field) || required.has(field)) return false
    if (field === 'abstract' && !added.has(field)) return false
    // A field containing only whitespace still exists in the BibTeX source.
    // Do not hide its textarea after closing and reopening the preview.
    return entry.hasField(field) || added.has(field)
  })
}
