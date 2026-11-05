/** English labels for BibTeX/BibLaTeX field names. These identifiers stay in English. */

const FIELD_LABELS: Record<string, string> = {
  abstract: 'Abstract',
  address: 'Address',
  annote: 'Annotation',
  archiveprefix: 'Archive prefix',
  affiliation: 'Affiliation',
  addendum: 'Addendum',
  afterword: 'Afterword',
  annotator: 'Annotator',
  author: 'Author',
  bookauthor: 'Book author',
  booksubtitle: 'Book subtitle',
  booktitle: 'Book title',
  booktitleaddon: 'Book title addon',
  chapter: 'Chapter',
  commentator: 'Commentator',
  crossref: 'Cross-reference',
  date: 'Date',
  doi: 'Digital object identifier (DOI)',
  edition: 'Edition',
  editor: 'Editor',
  editora: 'Editor A',
  editorb: 'Editor B',
  editorc: 'Editor C',
  eid: 'EID',
  eprint: 'Eprint',
  eprintclass: 'Eprint class',
  eprinttype: 'Eprint type',
  eventdate: 'Event date',
  eventtitle: 'Event title',
  eventtitleaddon: 'Event title addon',
  foreword: 'Foreword',
  holder: 'Holder',
  howpublished: 'How published',
  institution: 'Institution',
  introduction: 'Introduction',
  isbn: 'ISBN',
  isrn: 'ISRN',
  issn: 'ISSN',
  issue: 'Issue',
  issuesubtitle: 'Issue subtitle',
  issuetitle: 'Issue title',
  issuetitleaddon: 'Issue title addon',
  journal: 'Journal',
  journalsubtitle: 'Journal subtitle',
  journaltitle: 'Journal title',
  journaltitleaddon: 'Journal title addon',
  language: 'Language',
  location: 'Location',
  mainsubtitle: 'Main subtitle',
  maintitle: 'Main title',
  maintitleaddon: 'Main title addon',
  month: 'Month',
  note: 'Note',
  number: 'Number',
  organization: 'Organization',
  origlanguage: 'Original language',
  pages: 'Pages',
  pagetotal: 'Page total',
  part: 'Part',
  primaryclass: 'Primary class',
  publisher: 'Publisher',
  pubstate: 'Publication state',
  school: 'School',
  series: 'Series',
  subtitle: 'Subtitle',
  title: 'Title',
  titleaddon: 'Title addon',
  translator: 'Translator',
  type: 'Type',
  url: 'URL',
  urldate: 'URL date',
  venue: 'Venue',
  version: 'Version',
  volume: 'Volume',
  volumes: 'Volumes',
  year: 'Year',
}

const FIELD_GROUP_KEYS: Record<string, string> = {
  Common: 'common',
  Contributors: 'bib_field_group_contributors',
  'Books and volumes': 'bib_field_group_books_and_volumes',
  'Periodicals and journals': 'bib_field_group_periodicals_and_journals',
  'Events and conferences': 'bib_field_group_events_and_conferences',
  'Publication details': 'bib_field_group_publication_details',
  'Digital and online': 'bib_field_group_digital_and_online',
  'Language and origin': 'bib_field_group_language_and_origin',
}

type Translate = (key: string) => string

export function fieldLabel(name: string): string {
  const known = FIELD_LABELS[name.toLowerCase()]
  if (known) return known

  return name
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function fieldGroupLabel(label: string, translate: Translate): string {
  const key = FIELD_GROUP_KEYS[label]
  return key ? translate(key) : label
}
