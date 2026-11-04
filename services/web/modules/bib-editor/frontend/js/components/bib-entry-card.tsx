/**
 * One bibliography row in the entry list. The row shows compact metadata and
 * delegates selection/detail editing to the surrounding list/panel.
 * Each source occurrence has its own id, including duplicate citation keys.
 */
import React, { useCallback, useMemo, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { plural } from '../utils/plural'
import type { PositionedBibtexEntry } from '../utils/bib-types'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import type { BibSourceDiagnostic } from '../utils/bib-source-diagnostics'
import {
  getBibEntryDiagnostics,
  translateBibSourceDiagnostic,
} from '../utils/bib-entry-diagnostics'
import { missingRequiredLabels, splitHighlighted } from '../utils/preview-model'
import { formatWarningLabels } from '../utils/bib-validate'
import { citationAuthorSurnames, humanizeCitationHeading } from '../utils/overleaf-type-map.ts'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import BibEntryWarningSummary from './bib-entry-warning-summary'

function Highlighted({ text, search }: { text: string; search: string }) {
  const segments = splitHighlighted(text, search)
  if (segments.length <= 1 && !segments[0]?.match) {
    return <>{text}</>
  }
  return (
    <>
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i}>{s.text}</mark>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        )
      )}
    </>
  )
}

type EntryStatusTooltipProps = {
  id: string
  description: React.ReactNode
  ariaLabel: string
  icon: 'error' | 'warning'
  className?: string
}

function EntryStatusTooltip({
  id,
  description,
  ariaLabel,
  icon,
  className = 'bibtex-entry-error-icon',
}: EntryStatusTooltipProps) {
  return (
    <OLTooltip
      id={id}
      description={description}
      tooltipProps={{ className: 'bibtex-tooltip-errors' }}
      overlayProps={{ placement: 'right', trigger: ['hover', 'focus'] }}
    >
      <button type="button" className={className} aria-label={ariaLabel}>
        <span className="material-symbols" aria-hidden="true" translate="no">
          {icon}
        </span>
      </button>
    </OLTooltip>
  )
}

// The parsed entry object is unchanged by position-only CodeMirror edits.
// Keep metadata, warning computation and tooltip rendering independent of the
// outer row's current source coordinates and selection state.
const BibEntryCardContent = React.memo(function BibEntryCardContent({
  bibEntry,
  displayKey,
  missingFields,
  diagnostics,
  search,
  rowId,
  duplicate,
}: {
  bibEntry: BibtexEntry
  displayKey: string
  missingFields: string[]
  diagnostics: BibSourceDiagnostic[]
  search: string
  rowId: string
  duplicate?: boolean
}) {
  const { t } = useTranslation()
  const title = bibEntry.getField('title').toDisplayString()
  const badlyFormattedFields = formatWarningLabels(bibEntry)
  const hasErrors = missingFields.length > 0
  const hasWarnings = hasErrors || badlyFormattedFields.length > 0
  const warningDescription = (
    <BibEntryWarningSummary
      missingFields={missingFields}
      badlyFormattedFields={badlyFormattedFields}
      requiredFieldsTitle={plural(
        t,
        missingFields.length,
        'missing_field_for_entry_type',
        'missing_fields_for_entry_type',
        { entryType: bibEntry.type.toLowerCase() }
      )}
      badlyFormattedFieldsTitle={plural(
        t,
        badlyFormattedFields.length,
        'badly_formatted_field',
        'badly_formatted_fields'
      )}
      listFields
    />
  )
  const syntaxErrorMessages = diagnostics.map(diagnostic =>
    translateBibSourceDiagnostic(diagnostic, t)
  )
  const syntaxErrorDescription = (
    <>
      <strong>
        {plural(t, syntaxErrorMessages.length, 'entry_has_syntax_error', 'entry_has_syntax_errors')}:
      </strong>
      <ul>
        {syntaxErrorMessages.map((message, index) => (
          <li key={`${index}-${message}`}>{message}</li>
        ))}
      </ul>
    </>
  )
  const duplicateKeyMessage = t('bibtex_duplicates_keys')

  const citationHeading = useMemo(
    () => humanizeCitationHeading(bibEntry),
    [bibEntry]
  )
  const year = bibEntry.getYear().trim()
  const yearSuffix = year ? ` (${year})` : ''
  const citationAuthor =
    yearSuffix && citationHeading.endsWith(yearSuffix)
      ? citationHeading.slice(0, -yearSuffix.length)
      : citationHeading
  const hasCitationPerson = citationAuthorSurnames(bibEntry).surnames.length > 0

  return (
    <div className="bibtex-entry-card-content">
      <div className="bibtex-entry-card-header">
        <div className="bibtex-entry-card-key">
          <Highlighted text={displayKey} search={search} />
        </div>
        {syntaxErrorMessages.length > 0 && (
          <EntryStatusTooltip
            id={`tooltip-entry-syntax-errors-${rowId}`}
            description={syntaxErrorDescription}
            ariaLabel={syntaxErrorMessages.join(' + ')}
            icon="error"
          />
        )}
        {duplicate && (
          <EntryStatusTooltip
            id={`tooltip-duplicate-key-${rowId}`}
            description={duplicateKeyMessage}
            ariaLabel={duplicateKeyMessage}
            icon="warning"
          />
        )}
        {hasWarnings && (
          <EntryStatusTooltip
            id={`tooltip-missed-field-${rowId}`}
            description={warningDescription}
            ariaLabel={t('entry_has_warnings')}
            icon="warning"
            className="bibtex-entry-error-icon bibtex-entry-error-icon-warning"
          />
        )}
      </div>
      <div className="bibtex-entry-card-details">
        {title && (
          <div className="bibtex-entry-card-title">
            <span>
              <Highlighted text={title} search={search} />
            </span>
          </div>
        )}
        <div className="bibtex-entry-card-meta">
          {hasCitationPerson && (
            <div className="bibtex-entry-card-author">
              <span>
                <Highlighted text={citationAuthor} search={search} />
              </span>
            </div>
          )}
          {year && (
            <div className="bibtex-entry-card-year">
              <span>
                <Highlighted text={year} search={search} />
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

function BibEntryCard({
  entry,
  displayKey,
  onSelect,
  previewing,
  checked,
  onToggleSelect,
  search,
  rowId,
  duplicate,
}: {
  entry: PositionedBibtexEntry
  displayKey: string
  onSelect: (entry: PositionedBibtexEntry) => void
  previewing: boolean
  checked: boolean
  onToggleSelect?: (id: string) => void
  /** Raw search text used to highlight matching pieces of the card. */
  search: string
  rowId: string
  /** True when another entry has the same citation key. */
  duplicate?: boolean
}) {
  const t = useTranslation().t
  const bibEntry = entry.entry
  // Cache labels for both the row status and its memoized warning tooltip.
  const missingFields = useMemo(
    () => missingRequiredLabels(bibEntry, t('or')),
    [bibEntry, t]
  )

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as Element | null
      if (target?.closest('button, input, label')) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(entry)
      }
    },
    [entry, onSelect]
  )

  const toggleId = rowId
  const checkboxId = useId()

  return (
    <div
      id={`bibtex-entry-card-${toggleId}`}
      className={[
        'bibtex-entry-card',
        'bibtex-entry-card-compact',
        'bibtex-entry-card-clickable',
        checked ? 'bibtex-entry-card-selected' : '',
        missingFields.length > 0 ? 'bibtex-entry-card-errors' : '',
        previewing ? 'bibtex-entry-card-previewing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      onClick={e => {
        const target = e.target as Element | null
        if (target?.closest('input, label')) return
        onSelect(entry)
      }}
      onKeyDown={handleCardKeyDown}
    >
      <div className="wide-target-checkbox bibtex-entry-card-checkbox">
        <span className="wide-target-checkbox-box">
          <OLFormCheckbox
            id={checkboxId}
            onClick={e => e.stopPropagation()}
            onChange={() => onToggleSelect?.(toggleId)}
            checked={checked}
            autoComplete="off"
            aria-label={t('select_entry')}
          />
          <label
            className="wide-target-checkbox-target"
            htmlFor={checkboxId}
            aria-hidden="true"
          />
        </span>
      </div>
      <BibEntryCardContent
        bibEntry={bibEntry}
        displayKey={displayKey}
        missingFields={missingFields}
        diagnostics={getBibEntryDiagnostics(entry)}
        search={search}
        rowId={rowId}
        duplicate={duplicate}
      />
    </div>
  )
}

export default React.memo(BibEntryCard)
