/**
 * Modal for creating a new bibliography entry. The same BibEntryForm is reused
 * here as in the inline preview, but the host controls when the new entry is
 * committed to the document.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalHeader,
  OLModalTitle,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import BibEntryForm from './bib-entry-form'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'

const EMPTY_FOOTER_STATE = { disabled: true, submit: () => {} }

type Props = {
  show: boolean
  existingIds: string[]
  /** Save a new entry (the panel routes it through writeEntry(new)). */
  onSave: (entry: BibtexEntry) => Promise<boolean>
  onHide: () => void
  optionalExpanded?: boolean
  onOptionalExpandedChange?: (expanded: boolean) => void
}

export default function BibManualModal({
  show,
  existingIds,
  onSave,
  onHide,
  optionalExpanded,
  onOptionalExpandedChange,
}: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [footerState, setFooterState] = useState<{ disabled: boolean; submit: () => void }>(
    EMPTY_FOOTER_STATE
  )

  useEffect(() => {
    if (show) {
      setSaving(false)
      setSaveFailed(false)
    } else {
      // Discard the previous form's Save callback before the next opening.
      setFooterState(EMPTY_FOOTER_STATE)
    }
  }, [show])

  const initialEntry = useMemo(
    () => new BibtexEntry({ type: 'article', key: '', fields: new Map() }),
    []
  )

  const handleHide = useCallback(() => {
    if (!saving) onHide()
  }, [onHide, saving])

  const handleFormChecked = useCallback(async (entry: BibtexEntry, kind: 'existing' | 'new') => {
    if (kind !== 'new' || saving) return false
    setSaving(true)
    let saved = false
    try {
      saved = await onSave(entry)
    } catch (error) {
      console.error('BibTeX manual entry save failed', error)
    } finally {
      setSaving(false)
    }
    setSaveFailed(!saved)
    if (saved) handleHide()
    return saved
  }, [onSave, saving, handleHide])

  return (
    <OLModal
      data-bib-editor-dialog
      show={show}
      onHide={handleHide}
      themed
      scrollable
    >
      <OLModalHeader>
        <OLModalTitle>{t('add_reference')}</OLModalTitle>
      </OLModalHeader>
      {show && (
        <OLModalBody>
          {saveFailed && (
            <div className="bibtex-write-failure-banner" role="alert">
              <span className="bibtex-write-failure-banner-text">
                {t('could_not_save_bib_file')}
              </span>
            </div>
          )}
          <OLForm
            id="bibtex-manual-entry-form"
            className="bibtex-entry-form"
          >
            <BibEntryForm
              key="open"
              entry={initialEntry}
              optionalExpanded={optionalExpanded}
              onOptionalExpandedChange={onOptionalExpandedChange}
              kind="new"
              existingIds={existingIds}
              idPrefix="bib-manual-"
              onFormChange={() => setSaveFailed(false)}
              onChecked={handleFormChecked}
              submitDisabled={saving}
              onFooterStateChange={setFooterState}
            />
          </OLForm>
        </OLModalBody>
      )}
        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleHide} disabled={saving}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            disabled={!show || footerState.disabled || saving}
            onClick={footerState.submit}
            type="button"
          >
            {saving ? '…' : t('save')}
          </OLButton>
        </OLModalFooter>
    </OLModal>
  )
}
