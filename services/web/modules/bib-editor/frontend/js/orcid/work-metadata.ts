/** ORCID work-summary fallback and provider selection, independent of UI. */
import type { OrcidImportItem, Work, WorkVariant } from './orcid-api'

/** Preserve title/year from the selected summary when absent in full details. */
export function withWorkSummary(item: OrcidImportItem, summary: Work): OrcidImportItem {
  if (!item.work) return item
  const work = item.work
  const year = summary.year.trim()
  const title = summary.title.trim()
  const missingYear = !!year && !work['publication-date']?.year?.value?.trim()
  const missingTitle = !!title && !work.title?.title?.value?.trim()
  if (!missingYear && !missingTitle) return item
  return { ...item, work: {
    ...work,
    ...(missingYear ? { 'publication-date': {
      ...work['publication-date'], year: { value: year },
    } } : {}),
    ...(missingTitle ? { title: { title: { value: title } } } : {}),
  } }
}

/** A conservative structured-metadata score; citation parsing stays in the host. */
export function workMetadataScore(summary: WorkVariant, item: OrcidImportItem): number {
  const work = item.work
  const ids = work?.['external-ids']?.['external-id'] ?? summary.preferredExternalIds ?? []
  return Number(!!(work?.title?.title?.value || summary.title).trim()) * 2 +
    Number(/^\d{4}$/.test(work?.['publication-date']?.year?.value || summary.year)) * 2 +
    Number(!!(work?.['journal-title']?.value || summary.journalTitle)?.trim()) +
    Number(ids.some(id => id['external-id-type']?.toLowerCase() === 'doi')) * 2 +
    Number(!!work?.contributors?.contributor?.some(person => person['credit-name']?.value?.trim())) * 8
}

/** Do not fetch alternate details for otherwise usable records. */
export function hasMissingWorkFields(summary: WorkVariant, item: OrcidImportItem): boolean {
  if (!item.work) return false
  return !(item.work.title?.title?.value || summary.title).trim() ||
    !/^\d{4}$/.test(item.work['publication-date']?.year?.value || summary.year)
}
