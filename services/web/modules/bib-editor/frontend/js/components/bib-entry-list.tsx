/**
 * List of BibTeX entries shown in the sidebar panel.
 * Shows a compact card for each entry, with edit/delete actions.
 */
import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParsedBibEntry } from '../utils/bib-parser'
import { getEntryType } from '../utils/bib-types'

type Props = {
  entries: ParsedBibEntry[]
  onSelect: (entry: ParsedBibEntry) => void
  onDelete: (entry: ParsedBibEntry) => void
  onAdd: () => void
}

export default function BibEntryList({
  entries,
  onSelect,
  onDelete,
  onAdd,
}: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e => {
      const title = (e.fields.title || '').toLowerCase()
      const author = (e.fields.author || '').toLowerCase()
      const id = e.id.toLowerCase()
      const year = (e.fields.year || '').toLowerCase()
      const journal = (e.fields.journal || e.fields.booktitle || '').toLowerCase()
      return (
        title.includes(q) ||
        author.includes(q) ||
        id.includes(q) ||
        year.includes(q) ||
        journal.includes(q)
      )
    })
  }, [entries, search])

  const handleDelete = useCallback(
    (entry: ParsedBibEntry, e: React.MouseEvent) => {
      e.stopPropagation()
      if (confirmDelete === entry.id) {
        onDelete(entry)
        setConfirmDelete(null)
      } else {
        setConfirmDelete(entry.id)
        // Auto-clear confirmation after 3 seconds
        setTimeout(() => setConfirmDelete(null), 3000)
      }
    },
    [confirmDelete, onDelete]
  )

  return (
    <div className="bib-entry-list">
      {/* Search + Add bar */}
      <div className="bib-list-toolbar">
        <input
          className="form-control bib-list-search"
          placeholder={t('Search entries...') || 'Search entries...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label={t('Search bibliography entries') || undefined}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={onAdd}
          title={t('Add new entry')}
        >
          + {t('Add')}
        </button>
      </div>

      {/* Entry count */}
      <div className="bib-list-count">
        {filteredEntries.length === entries.length
          ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
          : `${filteredEntries.length} of ${entries.length} entries`}
      </div>

      {/* Entry list */}
      <div className="bib-list-entries">
        {filteredEntries.length === 0 && (
          <div className="bib-list-empty">
            {entries.length === 0
              ? t('No bibliography entries yet. Click "Add" to create one.')
              : t('No entries match your search.')}
          </div>
        )}
        {filteredEntries.map(entry => (
          <BibEntryCard
            key={`${entry.id}-${entry.sourceStart}`}
            entry={entry}
            onSelect={onSelect}
            onDelete={handleDelete}
            isConfirmingDelete={confirmDelete === entry.id}
          />
        ))}
      </div>
    </div>
  )
}

function BibEntryCard({
  entry,
  onSelect,
  onDelete,
  isConfirmingDelete,
}: {
  entry: ParsedBibEntry
  onSelect: (e: ParsedBibEntry) => void
  onDelete: (e: ParsedBibEntry, ev: React.MouseEvent) => void
  isConfirmingDelete: boolean
}) {
  const { t } = useTranslation()
  const typeDef = getEntryType(entry.type)
  const title = entry.fields.title || t('Untitled')
  const author = entry.fields.author || ''
  const year = entry.fields.year || ''
  const venue =
    entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || ''

  // Truncate long author lists
  const authorDisplay = useMemo(() => {
    const parts = author.split(/\s+and\s+/i)
    if (parts.length <= 2) return author
    return `${parts[0]} et al.`
  }, [author])

  return (
    <div
      className="bib-entry-card"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(entry)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(entry)
      }}
    >
      <div className="bib-entry-card-header">
        <span className="bib-entry-card-type">@{entry.type}</span>
        <span className="bib-entry-card-key">{entry.id}</span>
      </div>
      <div className="bib-entry-card-title">{title}</div>
      {(authorDisplay || year) && (
        <div className="bib-entry-card-meta">
          {authorDisplay && <span>{authorDisplay}</span>}
          {authorDisplay && year && <span> · </span>}
          {year && <span>{year}</span>}
          {venue && <span> · {venue}</span>}
        </div>
      )}
      <div className="bib-entry-card-actions">
        <button
          className="btn btn-success btn-sm"
          onClick={e => {
            e.stopPropagation()
            onSelect(entry)
          }}
          title={t('Edit entry')}
        >
          {t('Edit')}
        </button>
        <button
          className="btn btn-danger btn-sm"
          onClick={e => onDelete(entry, e)}
          title={
            isConfirmingDelete
              ? t('Click again to confirm deletion')
              : t('Delete entry')
          }
        >
          {isConfirmingDelete ? t('Confirm Delete') : t('Delete')}
        </button>
      </div>
    </div>
  )
}
