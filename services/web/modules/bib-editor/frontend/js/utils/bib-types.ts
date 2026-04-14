/**
 * BibTeX entry type definition and field metadata.
 */

export type BibEntry = {
  type: string
  id: string
  fields: Record<string, string>
}

export type BibEntryType = {
  name: string
  label: string
  requiredFields: string[]
  optionalFields: string[]
}

export const ENTRY_TYPES: BibEntryType[] = [
  {
    name: 'article',
    label: 'Article',
    requiredFields: ['author', 'title', 'journal', 'year'],
    optionalFields: [
      'volume',
      'number',
      'pages',
      'month',
      'doi',
      'url',
      'note',
      'abstract',
      'keywords',
    ],
  },
  {
    name: 'book',
    label: 'Book',
    requiredFields: ['author', 'title', 'publisher', 'year'],
    optionalFields: [
      'editor',
      'volume',
      'series',
      'address',
      'edition',
      'month',
      'isbn',
      'doi',
      'url',
      'note',
      'abstract',
    ],
  },
  {
    name: 'inproceedings',
    label: 'Conference Paper',
    requiredFields: ['author', 'title', 'booktitle', 'year'],
    optionalFields: [
      'editor',
      'volume',
      'series',
      'pages',
      'address',
      'month',
      'organization',
      'publisher',
      'doi',
      'url',
      'note',
      'abstract',
    ],
  },
  {
    name: 'incollection',
    label: 'In Collection',
    requiredFields: ['author', 'title', 'booktitle', 'publisher', 'year'],
    optionalFields: [
      'editor',
      'volume',
      'series',
      'chapter',
      'pages',
      'address',
      'edition',
      'month',
      'doi',
      'url',
      'note',
    ],
  },
  {
    name: 'phdthesis',
    label: 'PhD Thesis',
    requiredFields: ['author', 'title', 'school', 'year'],
    optionalFields: ['address', 'month', 'doi', 'url', 'note', 'abstract'],
  },
  {
    name: 'mastersthesis',
    label: 'Master\'s Thesis',
    requiredFields: ['author', 'title', 'school', 'year'],
    optionalFields: ['address', 'month', 'doi', 'url', 'note', 'abstract'],
  },
  {
    name: 'techreport',
    label: 'Technical Report',
    requiredFields: ['author', 'title', 'institution', 'year'],
    optionalFields: [
      'number',
      'address',
      'month',
      'doi',
      'url',
      'note',
      'abstract',
    ],
  },
  {
    name: 'misc',
    label: 'Miscellaneous',
    requiredFields: [],
    optionalFields: [
      'author',
      'title',
      'howpublished',
      'month',
      'year',
      'doi',
      'url',
      'note',
    ],
  },
  {
    name: 'unpublished',
    label: 'Unpublished',
    requiredFields: ['author', 'title', 'note'],
    optionalFields: ['month', 'year', 'doi', 'url'],
  },
  {
    name: 'proceedings',
    label: 'Proceedings',
    requiredFields: ['title', 'year'],
    optionalFields: [
      'editor',
      'volume',
      'series',
      'address',
      'month',
      'organization',
      'publisher',
      'doi',
      'url',
      'note',
    ],
  },
  {
    name: 'booklet',
    label: 'Booklet',
    requiredFields: ['title'],
    optionalFields: [
      'author',
      'howpublished',
      'address',
      'month',
      'year',
      'doi',
      'url',
      'note',
    ],
  },
  {
    name: 'manual',
    label: 'Manual',
    requiredFields: ['title'],
    optionalFields: [
      'author',
      'organization',
      'address',
      'edition',
      'month',
      'year',
      'doi',
      'url',
      'note',
    ],
  },
  {
    name: 'inbook',
    label: 'In Book',
    requiredFields: ['author', 'title', 'chapter', 'publisher', 'year'],
    optionalFields: [
      'volume',
      'series',
      'address',
      'edition',
      'month',
      'pages',
      'doi',
      'url',
      'note',
    ],
  },
]

/** All known BibTeX field names */
export const ALL_FIELDS = [
  'author',
  'title',
  'journal',
  'booktitle',
  'year',
  'month',
  'volume',
  'number',
  'pages',
  'publisher',
  'editor',
  'school',
  'institution',
  'organization',
  'series',
  'edition',
  'chapter',
  'address',
  'howpublished',
  'doi',
  'url',
  'isbn',
  'issn',
  'keywords',
  'abstract',
  'note',
  'language',
  'file',
] as const

export function getEntryType(name: string): BibEntryType | undefined {
  return ENTRY_TYPES.find(t => t.name === name.toLowerCase())
}

/** Get all relevant fields for a given entry type (required + optional), preserving order */
export function getFieldsForType(typeName: string): string[] {
  const entryType = getEntryType(typeName)
  if (!entryType) return [...ALL_FIELDS]
  const fields = [...entryType.requiredFields, ...entryType.optionalFields]
  // Include any ALL_FIELDS not already in the list
  for (const f of ALL_FIELDS) {
    if (!fields.includes(f)) fields.push(f)
  }
  return fields
}
