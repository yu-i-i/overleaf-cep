import { useTranslation } from 'react-i18next'
import type { WordCountData } from '@/features/word-count-modal/components/word-count-data'
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

const selectedWordTotal = (data: WordCountData) => {
  return (
    data.textWords +
    data.headWords +
    data.abstractWords +
    data.captionWords +
    data.footnoteWords +
    data.otherWords
  )
}

type SelectedWordCountModalProps = {
  show: boolean
  onClose: () => void
  data: WordCountData | null
  error: boolean
}

export default function SelectedWordCountModal({
  show,
  onClose,
  data,
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
        <OLModalTitle>{t('word_count_selected_text')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {!data && !error && <LoadingSpinner />}
        {error && <WordCountError />}
        {data && (
          <div className="d-flex align-items-baseline justify-content-between">
            <span>{t('words')}</span>
            <strong className="h2 mb-0" data-testid="selected-word-count-total">
              {numberFormat.format(selectedWordTotal(data))}
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
