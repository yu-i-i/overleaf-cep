/** The visible row and its distance above the list viewport's top edge. */
export type BibListPosition = {
  entryId: string
  offset: number
  scrollTop: number
}

/** Capture the first visible bibliography row without depending on prior row heights. */
export function captureBibListPosition(list: HTMLElement): BibListPosition | null {
  const rows = list.querySelector('.bibtex-entry-list-body')?.children
  if (!rows?.length) return null

  const viewportTop = list.getBoundingClientRect().top
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows[middle].getBoundingClientRect().bottom <= viewportTop) low = middle + 1
    else high = middle
  }
  const row = rows[Math.min(low, rows.length - 1)] as HTMLElement
  const entryId = row.dataset.entryId
  if (!entryId) return null
  return {
    entryId,
    offset: viewportTop - row.getBoundingClientRect().top,
    scrollTop: list.scrollTop,
  }
}

/** Restore the same visible row and in-row offset, even if preceding rows changed height. */
export function restoreBibListPosition(list: HTMLElement, position: BibListPosition): boolean {
  const rows = list.querySelector('.bibtex-entry-list-body')?.children
  if (!rows?.length) return false
  const row = Array.from(rows).find(item => (item as HTMLElement).dataset.entryId === position.entryId)
  if (!row) {
    // Final fallback policy for filtered lists: use the saved pixel offset,
    // accept the restoration, and track subsequent scrolling in that filter.
    // Clearing the filter does not retry the former (now absent) row anchor.
    list.scrollTop = position.scrollTop
    return true
  }
  const viewportTop = list.getBoundingClientRect().top
  const rowTop = row.getBoundingClientRect().top
  list.scrollTop += rowTop - viewportTop + position.offset
  return true
}
