import { useTranslation } from 'react-i18next'
import { Col, Container, Row } from 'react-bootstrap'
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
import type { SelectedWordCountResult } from '../utils/count-words-in-selection'

const numberFormat = new Intl.NumberFormat()

type SelectedWordCountModalProps = {
  show: boolean
  onClose: () => void
  data: SelectedWordCountResult | null
  error: boolean
}

export default function SelectedWordCountModal({
  show,
  onClose,
  data,
  error,
}: SelectedWordCountModalProps) {
  const { t } = useTranslation()

  const rows = data
    ? [
        {
          key: 'total',
          label: t('total_words'),
          value: data.totalWords,
          testId: 'selected-word-count-total',
        },
        {
          key: 'headers',
          label: t('headers'),
          value: data.headers,
          testId: 'selected-word-count-headers',
        },
        {
          key: 'math-inline',
          label: t('math_inline'),
          value: data.mathInline,
          testId: 'selected-word-count-math-inline',
        },
        {
          key: 'math-display',
          label: t('math_display'),
          value: data.mathDisplay,
          testId: 'selected-word-count-math-display',
        },
      ]
    : []

  return (
    <OLModal
      animation
      show={show}
      onHide={onClose}
      initialFocus={false}
      id="selected-word-count-modal"
      data-testid="selected-word-count-modal"
    >
      <OLModalHeader>
        <OLModalTitle>{t('word_count_lower')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {data === null && !error && <LoadingSpinner />}
        {error && <WordCountError />}
        {data !== null && (
          <Container fluid>
            {rows.map(({ key, label, value, testId }) => (
              <Row key={key}>
                <Col xs={4}>
                  <div className="float-end">{label}:</div>
                </Col>
                <Col xs={6} data-testid={testId}>
                  {numberFormat.format(value)}
                </Col>
              </Row>
            ))}
          </Container>
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
