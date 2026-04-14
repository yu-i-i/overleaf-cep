/**
 * BibEditor sidebar panel — the main component rendered in the rail tab.
 * Similar in structure to ChatPane: header + scrollable content.
 *
 * States:
 * - Not a .bib file: shows an informative placeholder
 * - List mode: shows searchable entry list with add/delete
 * - Edit mode: shows the entry form
 * - Add mode: shows an empty entry form
 */
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import MaterialIcon from '@/shared/components/material-icon'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { useBibEditorContext } from '../context/bib-editor-context'
import BibEntryList from './bib-entry-list'
import BibEntryForm from './bib-entry-form'
import type { BibEntry } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'

function BibEditorPanel() {
  const { t } = useTranslation()
  const {
    isBibFile,
    entries,
    selectedEntry,
    mode,
    setMode,
    selectEntry,
    saveEntry,
    addEntry,
    deleteEntry,
  } = useBibEditorContext()

  const handleAdd = useCallback(() => {
    setMode('add')
  }, [setMode])

  const handleSaveEdit = useCallback(
    (updated: BibEntry) => {
      if (selectedEntry) {
        saveEntry(selectedEntry, updated)
      }
    },
    [selectedEntry, saveEntry]
  )

  const handleSaveNew = useCallback(
    (entry: BibEntry) => {
      addEntry(entry)
    },
    [addEntry]
  )

  const handleCancel = useCallback(() => {
    selectEntry(null)
    setMode('list')
  }, [selectEntry, setMode])

  const handleSelect = useCallback(
    (entry: ParsedBibEntry) => {
      selectEntry(entry)
    },
    [selectEntry]
  )

  const handleDelete = useCallback(
    (entry: ParsedBibEntry) => {
      deleteEntry(entry)
    },
    [deleteEntry]
  )

  // Header actions: back button when editing
  const headerActions =
    mode !== 'list' ? (
      <button
        className="btn btn-sm rail-panel-header-button-subdued"
        onClick={handleCancel}
        title={t('Back to list')}
      >
        <MaterialIcon type="arrow_back" />
      </button>
    ) : undefined

  const headerTitle =
    mode === 'edit'
      ? t('Edit Entry')
      : mode === 'add'
        ? t('New Entry')
        : t('Bibliography')

  return (
    <div className="bib-editor-panel">
      <RailPanelHeader title={headerTitle} actions={headerActions} />
      <div className="bib-editor-panel-content">
        {!isBibFile ? (
          <BibEditorPlaceholder />
        ) : mode === 'list' ? (
          <BibEntryList
            entries={entries}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        ) : mode === 'edit' && selectedEntry ? (
          <BibEntryForm
            entry={{
              type: selectedEntry.type,
              id: selectedEntry.id,
              fields: { ...selectedEntry.fields },
            }}
            onSave={handleSaveEdit}
            onCancel={handleCancel}
            existingIds={entries.map(e => e.id)}
          />
        ) : mode === 'add' ? (
          <BibEntryForm
            entry={{ type: 'article', id: '', fields: {} }}
            onSave={handleSaveNew}
            onCancel={handleCancel}
            isNew
            existingIds={entries.map(e => e.id)}
          />
        ) : null}
      </div>
    </div>
  )
}

function BibEditorPlaceholder() {
  const { t } = useTranslation()
  return (
    <div className="bib-editor-placeholder">
      <div>
        <span className="bib-editor-placeholder-icon">
          <MaterialIcon type="book_5" />
        </span>
      </div>
      <div className="bib-editor-placeholder-text">
        <div className="bib-editor-placeholder-title">
          {t('Bibliography Editor')}
        </div>
        <div className="bib-editor-placeholder-body">
          {t(
            'Open a .bib file to manage your bibliography entries with a visual editor.'
          )}
        </div>
      </div>
    </div>
  )
}

function BibEditorFallback() {
  const { t } = useTranslation()
  return (
    <div className="bib-editor-panel">
      <div className="bib-editor-placeholder">
        <div className="bib-editor-placeholder-text">
          {t('Something went wrong loading the bibliography editor.')}
        </div>
      </div>
    </div>
  )
}

export default withErrorBoundary(BibEditorPanel, () => <BibEditorFallback />)
