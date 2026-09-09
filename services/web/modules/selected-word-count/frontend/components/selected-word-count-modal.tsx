import { useTranslation } from 'react-i18next'
import { WordCountError } from '@/features/word-count-modal/components/word-count-error'
import LoadingSpinner from '@/shared/components/loading-spinner'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'

const numberFormat = new Intl.NumberFormat()

type SelectedWordCountModalProps = {
  show: boolean
  onClose: () => void
  wordCount: number | null
  error: boolean
}

export default function SelectedWordCountModal({
  show,
  onClose,
  wordCount,
  error,
}: SelectedWordCountModalProps) {
  const { t } = useTranslation()

  return (
    <OLModal
      animation
      show={show}
      onHide={onClose}
      id="selected-word-count-modal"
      data-testid="selected-word-count-modal"
      size="sm"
    >
      <OLModalHeader>
        <OLModalTitle>{t('word_count')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {wordCount === null && !error && <LoadingSpinner />}
        {error && <WordCountError />}
        {wordCount !== null && (
          <div className="d-flex align-items-baseline justify-content-between">
            <span>{t('total_words')}</span>
            <strong className="h2 mb-0" data-testid="selected-word-count-total">
              {numberFormat.format(wordCount)}
            </strong>
          </div>
        )}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={onClose}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
