/**
 * Toolbar for selecting and acting on the entries currently visible in the list.
 * Selection itself is owned by BibEditorPanel; this component only presents the
 * state and sends user actions back to the panel.
 */
import React, { useId } from 'react'
import classnames from 'classnames'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import { plural } from '../utils/plural'
import '../../stylesheets/bib-editor-panel.css'

type Props = {
  filteredLength: number
  allSelected: boolean
  selectedIds: string[]
  onToggleSelectAll?: (kind: 'all' | 'none') => void
  onBulkDelete?: () => void
  onBulkDownload?: () => void
}

function BibBulkActionsBar({
  filteredLength,
  allSelected,
  selectedIds,
  onToggleSelectAll,
  onBulkDelete,
  onBulkDownload,
}: Props) {
  const { t } = useTranslation()
  const selectAllId = useId()
  const count = selectedIds.length || filteredLength

  return (
    <div
      className={classnames('bibtex-bulk-actions-bar', {
        'bibtex-bulk-actions-bar-selected': selectedIds.length > 0,
      })}
    >
      <div className="wide-target-checkbox bibtex-bulk-actions-select-all">
        <span className="wide-target-checkbox-box">
          <OLFormCheckbox
            id={selectAllId}
            onClick={e => e.stopPropagation()}
            onChange={e =>
              onToggleSelectAll?.(e.target.checked ? 'all' : 'none')
            }
            checked={allSelected}
            autoComplete="off"
            aria-label={t('select_all_entries')}
          />
          <label
            className="wide-target-checkbox-target"
            htmlFor={selectAllId}
            aria-hidden="true"
          />
        </span>
      </div>

      <div className="bibtex-bulk-actions-count">
        {`${count} ${plural(t, count, 'reference', 'references')}`}
      </div>

      {selectedIds.length > 0 && onBulkDelete ? (
        <OLButton
          size="sm"
          variant="ghost"
          leadingIcon={<MaterialIcon type="delete" unfilled />}
          onClick={e => {
            e.stopPropagation()
            onBulkDelete()
          }}
          aria-label={t('delete')}
        >
          <span className="bibtex-bulk-actions-btn-label">
            {t('delete')}
          </span>
        </OLButton>
      ) : null}

      {selectedIds.length > 0 && onBulkDownload ? (
        <OLButton
          size="sm"
          variant="ghost"
          leadingIcon="download"
          onClick={e => {
            e.stopPropagation()
            onBulkDownload()
          }}
          aria-label={t('download')}
        >
          <span className="bibtex-bulk-actions-btn-label">
            {t('download')}
          </span>
        </OLButton>
      ) : null}

      {selectedIds.length > 0 ? (
        <OLIconButton
          className="bibtex-bulk-actions-close"
          size="sm"
          variant="ghost"
          icon="close"
          onClick={e => {
            e.stopPropagation()
            onToggleSelectAll?.('none')
          }}
          aria-label={t('close')}
        />
      ) : null}
    </div>
  )
}

export default React.memo(BibBulkActionsBar)
