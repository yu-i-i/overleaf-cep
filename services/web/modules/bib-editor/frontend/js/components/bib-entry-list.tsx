/**
 * Filtered entry-list view. It derives the visible rows from the parsed source
 * list and passes each row to BibEntryCard; it does not own bibliography state.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PositionedBibtexEntry } from '../utils/bib-types'
import BibEntryCard from './bib-entry-card'
import { displayCitationKey } from '../utils/bib-key-generation'
import { captureBibListPosition, restoreBibListPosition } from '../utils/bib-list-position'
import type { BibListPosition } from '../utils/bib-list-position'

type Props = {
  entries: PositionedBibtexEntry[]
  existingIds: string[]
  onSelect: (entry: PositionedBibtexEntry) => void
  previewId?: string | null
  restoreKey?: string | null
  getRestorePosition?: () => BibListPosition | null
  onPositionChange?: (position: BibListPosition) => void
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  search: string
  totalEntries?: number
  duplicateIds?: Set<string>
}

function BibEntryList({
  entries,
  existingIds,
  onSelect,
  previewId = null,
  restoreKey = null,
  getRestorePosition,
  onPositionChange,
  selectedIds = [],
  onToggleSelect,
  search,
  totalEntries = entries.length,
  duplicateIds,
}: Props) {
  const { t } = useTranslation()

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const listRef = useRef<HTMLDivElement>(null)
  const restoredKeyRef = useRef<string | null>(null)
  const visibleRef = useRef(false)
  const restoreRef = useRef<() => void>(() => {})

  // The editor can remain mounted while a binary-file tab covers it. Restore
  // only when the list is actually visible, not merely when its session loads.
  const restore = useCallback(() => {
    const list = listRef.current
    if (!restoreKey || !list || restoredKeyRef.current === restoreKey) return
    const rect = list.getBoundingClientRect()
    if (!visibleRef.current || rect.width === 0 || rect.height === 0) return
    const restorePosition = getRestorePosition?.()
    if (restorePosition && !restoreBibListPosition(list, restorePosition)) return
    restoredKeyRef.current = restoreKey
  }, [restoreKey, getRestorePosition])

  useLayoutEffect(() => {
    restoreRef.current = restore
    if (!restoreKey) restoredKeyRef.current = null
    restore()
  }, [restore, restoreKey, entries])

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting
      if (visible !== visibleRef.current) {
        visibleRef.current = visible
        // A tab may hide and re-show the same document without changing its
        // session key or remounting the list. It needs a fresh restoration.
        restoredKeyRef.current = null
      }
      if (visible) restoreRef.current()
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={listRef}
      className="bibtex-entry-list"
      onScroll={event => {
        if (!visibleRef.current) return
        const list = event.currentTarget
        // Capture geometry now. Approximating from a previous scrollTop gives
        // a wrong anchor when the browser adjusts scroll for resized rows.
        const position = captureBibListPosition(list)
        if (position) onPositionChange?.(position)
      }}
    >
      {entries.length === 0 && (
        <div className="bibtex-list-empty">
          {totalEntries === 0
            ? t('no_bibliography_entries_yet_add_one')
            : t('no_entries_match_your_search')}
        </div>
      )}

      <div className="bibtex-entry-list-body" role="list">
        {entries.map((entry, i) => {
          const rowId = entry.entry.id
          return (
            <div
              key={rowId}
              data-index={i}
              data-entry-id={rowId}
              className="bibtex-entry-card-row"
              role="listitem"
            >
              <BibEntryCard
                entry={entry}
                displayKey={displayCitationKey(entry.entry, existingIds)}
                onSelect={onSelect}
                previewing={previewId === rowId}
                checked={selectedIdSet.has(rowId)}
                onToggleSelect={onToggleSelect}
                search={search}
                rowId={rowId}
                duplicate={duplicateIds?.has(rowId) ?? false}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default React.memo(BibEntryList)
