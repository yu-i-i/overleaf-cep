import React, { useEffect, useId, useMemo, useState } from 'react'
import classnames from 'classnames'
import { useTranslation } from 'react-i18next'
import { plural } from '../utils/plural'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLForm from '@/shared/components/ol/ol-form'
import Notification from '@/shared/components/notification'
import {
  OLDropdown,
  OLDropdownMenu,
  OLDropdownItem,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import BibEntryForm from './bib-entry-form'
import type { BibProjectedEntry } from '../utils/bib-entry-position'
import { textareaValueFromSource, toBibFormString } from '../utils/bib-field-edit'
import { getFieldType } from '../utils/bib-types'
import type { PositionedBibtexEntry } from '../utils/bib-types'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import {
  getBibEntryDiagnostics,
  translateBibSourceDiagnostic,
} from '../utils/bib-entry-diagnostics'
import type { BibFormChangeHandler } from '../context/bib-editor-context'
import { missingRequiredLabels } from '../utils/preview-model.ts'
import { humanizeCitationHeading } from '../utils/overleaf-type-map.ts'
import { displayCitationKey } from '../utils/bib-key-generation'
import type { BibNameDrafts } from '../utils/bib-author-draft'
import MaterialIcon from '@/shared/components/material-icon'
import BibEntryWarningSummary from './bib-entry-warning-summary'

type BibPreviewProps = {
  /** The current parsed entries (file order — the preview walks this) */
  entries: PositionedBibtexEntry[]
  /** The previewed entry (full parsed entry, from the current parse) */
  entry: BibProjectedEntry
  /** Exact source slice for this occurrence; upstream normalizes literal newlines. */
  sourceText?: string
  /** Index into `entries` (file order) */
  previewIndex: number
  onPrev: () => void
  onNext: () => void
  /** Close the preview; existing-entry edits have already been written. */
  onClose: () => void
  /** Download callback for the currently previewed entry. */
  onDownload: () => void
  /** Single-entry delete (confirm modal in the panel) */
  onDelete: () => void
  /** Receives the reusable form's current draft so the host can commit it. */
  onFormChange: BibFormChangeHandler
  existingIds: string[]
  canDelete: boolean
  readOnly?: boolean
  draftEntry?: BibtexEntry
  pendingNameDrafts?: BibNameDrafts
  /** Incremented when undo/redo requires discarding this entry's local draft. */
  draftReset?: { version: number; entry: BibtexEntry }
  optionalExpanded?: boolean
  onOptionalExpandedChange?: (expanded: boolean) => void
}

function BibEntryPreview({
  entries,
  entry,
  sourceText,
  previewIndex,
  onPrev,
  onNext,
  onClose,
  onDownload,
  onDelete,
  onFormChange,
  existingIds,
  canDelete,
  readOnly = false,
  draftEntry,
  pendingNameDrafts,
  draftReset,
  optionalExpanded,
  onOptionalExpandedChange,
}: BibPreviewProps) {
  const { t } = useTranslation()
  const bibEntry = entry.entry
  const syntaxErrors = getBibEntryDiagnostics(entry).map(diagnostic =>
    translateBibSourceDiagnostic(diagnostic, t)
  )
  const hasSyntaxErrors = syntaxErrors.length > 0
  const idPrefix = `bib-${useId()}-`
  const abstractId = `${idPrefix}abstract`
  const textareaSourceValues = useMemo(() => {
    const result: Record<string, string> = {}
    if (sourceText === undefined) return result
    // Trusted source-relative ranges come from the existing Lezer projection.
    // Malformed entries have no trusted ranges and are not editable.
    const ranges = entry.sourceFieldRanges ?? []
    for (const range of ranges) {
      if (getFieldType(range.name) !== 'large') continue
      const text = textareaValueFromSource(
        sourceText.slice(range.valueFrom, range.valueTo),
        toBibFormString(bibEntry.getField(range.name), range.name)
      )
      if (text !== null) result[range.name] = text
    }
    return result
  }, [sourceText, entry])
  const [tab, setTab] = useState<'details' | 'abstract'>('details')
  const selectAbstract = React.useCallback(() => setTab('abstract'), [])

  // Keep a single form mounted across tabs. Abstract uses the same change,
  // validation, draft and source-write path as every other field.
  useEffect(() => {
    if (tab !== 'abstract') return
    const raf = requestAnimationFrame(() => {
      document.getElementById(abstractId)?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [tab, abstractId])

  // Short labels are derived directly from the current parsed entry.
  const summaryTitle = bibEntry.getField('title').toDisplayString().trim()
  const summaryHeading = humanizeCitationHeading(bibEntry)

  const missing = useMemo(
    () => missingRequiredLabels(bibEntry, t('or')),
    [entry, t]
  )

  // Handle Escape at the preview container so either tab returns to the list.
  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    const el = e.target
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  const tabs = [
    { id: 'details', label: t('details') },
    { id: 'abstract', label: t('abstract') },
  ] as const

  // The form retains its local draft while the two tabs toggle visibility.
  // eslint-disable-next-line jsx-a11y/no-static-element-interactions
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  return (
    <div
      tabIndex={-1}
      className="bibtex-entry-preview-panel bibtex-entry-preview-panel-open"
      role="region"
      aria-label={t('edit_reference')}
      onKeyDown={handleBodyKeyDown}
    >
      <div className="bibtex-entry-preview-header">
        <div className="bibtex-entry-preview-header-nav">
          <OLIconButton
            icon="chevron_left"
            variant="ghost"
            unfilled
            aria-label={t('previous_reference')}
            disabled={previewIndex <= 0}
            onClick={onPrev}
          />
          <OLIconButton
            icon="chevron_right"
            variant="ghost"
            unfilled
            aria-label={t('next_reference')}
            disabled={previewIndex >= entries.length - 1}
            onClick={onNext}
          />
          {/* List collapse is controlled by the list pane, not this preview header. */}
        </div>
        <OLIconButton
          icon="close"
          variant="ghost"
          unfilled
          aria-label={t('close')}
          onClick={onClose}
        />
      </div>

      <div className="bibtex-entry-preview-content">
        {hasSyntaxErrors && (
          <div className="bibtex-entry-preview-summary">
            <Notification
              type="error"
              customIcon={(<MaterialIcon unfilled type="error" />)}
              content={
                <>
                  <p>
                    <b>{plural(t, syntaxErrors.length, 'entry_has_syntax_error', 'entry_has_syntax_errors')}:</b>
                  </p>
                  <ul>{syntaxErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>
                  <p>
                    {plural(t, syntaxErrors.length, 'correct_syntax_error_in_code_mode', 'correct_syntax_errors_in_code_mode')}
                  </p>
                </>
              }
            />
          </div>
        )}

        {/* Compact summary shown above the detailed fields. */}
        <div className="bibtex-entry-preview-summary">
          <div className="bibtex-entry-preview-summary-content">
            <div className="bibtex-entry-preview-summary-key-row">
              <div className="bibtex-entry-preview-summary-key">
                {displayCitationKey(bibEntry, existingIds)}
              </div>
            </div>
            {summaryTitle && (
              <div className="bibtex-entry-preview-summary-title">
                {summaryTitle}
              </div>
            )}
            {summaryHeading && summaryHeading !== bibEntry.key.trim() && (
              <div className="bibtex-entry-preview-summary-meta">
                <span>{summaryHeading}</span>
              </div>
            )}
          </div>
          {/* Actions for the currently previewed entry. */}
          <OLDropdown className="bibtex-entry-preview-summary-actions">
            <OLDropdownToggle
              className="d-inline-grid custom-toggle"
              size="sm"
              variant="ghost"
              aria-label={t('actions')}
            >
              <span className="button-content" aria-hidden="false">
                <span className="material-symbols unfilled" aria-hidden="true">
                  more_vert
                </span>
              </span>
            </OLDropdownToggle>
            <OLDropdownMenu>
              <OLDropdownItem leadingIcon="download" onClick={onDownload}>
                {t('download')}
              </OLDropdownItem>
              <OLDropdownItem
                leadingIcon="delete"
                onClick={onDelete}
                disabled={!canDelete}
              >
                {t('delete')}
              </OLDropdownItem>
            </OLDropdownMenu>
          </OLDropdown>
        </div>

        {missing.length > 0 && !hasSyntaxErrors && (
          <div className="bibtex-entry-preview-summary">
            <Notification
              type="warning"
              className="unfilled"
              customIcon={(<MaterialIcon unfilled type="warning" />)}
              content={
                <BibEntryWarningSummary
                  missingFields={missing}
                  badlyFormattedFields={[]}
                  requiredFieldsTitle={plural(
                    t,
                    missing.length,
                    'required_field_missing',
                    'required_fields_missing'
                  )}
                  badlyFormattedFieldsTitle={t('badly_formatted_fields')}
                />
              }
            />
          </div>
        )}

        <div
          className={classnames('bibtex-entry-preview-body', {
            'bibtex-entry-preview-body-abstract': tab === 'abstract',
          })}
        >
          <div className="bibtex-entry-preview-tabs" role="tablist" tabIndex={-1}>
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${idPrefix}tab-${id}`}
                aria-controls={`${idPrefix}panel-${id}`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                className={classnames('bibtex-entry-preview-tab', {
                  'bibtex-entry-preview-tab-active': tab === id,
                })}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <OLForm
            id="bibtex-entry-form"
            className={classnames('bibtex-entry-form', {
              'bibtex-entry-syntax-disabled': hasSyntaxErrors && !readOnly,
              'bibtex-entry-read-only': readOnly,
            })}
          >
            <fieldset
              className="bibtex-entry-preview-fields"
              disabled={hasSyntaxErrors || readOnly}
            >
              <BibEntryForm
                key={readOnly ? 'read-only' : 'editable'}
                entry={readOnly ? bibEntry : draftEntry ?? bibEntry}
                initialNameDrafts={pendingNameDrafts}
                sourceEntry={bibEntry}
                textareaSourceValues={textareaSourceValues}
                draftReset={draftReset}
                optionalExpanded={readOnly || optionalExpanded}
                onOptionalExpandedChange={onOptionalExpandedChange}
                kind="existing"
                previewTab={tab}
                existingIds={existingIds}
                onFormChange={onFormChange}
                onSelectAbstract={selectAbstract}
                idPrefix={idPrefix}
              />
            </fieldset>
          </OLForm>
        </div>
      </div>
    </div>
  )
}

export default React.memo(BibEntryPreview)
