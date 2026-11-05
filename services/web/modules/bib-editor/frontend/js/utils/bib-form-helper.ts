/** Return the translation key for a field's helper line, if it has one. */
export function helperKeyForField(fieldName: string): string | null {
  if (fieldName === 'pages') return 'bib_field_helper_page_range'
  if (fieldName === 'doi') return 'bib_field_helper_doi_identifier'
  if (fieldName === 'eprint') return 'bib_field_helper_preprint_archive_identifier'
  return null
}
