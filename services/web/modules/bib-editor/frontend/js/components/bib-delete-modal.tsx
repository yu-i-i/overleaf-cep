import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal, OLModalBody, OLModalFooter, OLModalHeader, OLModalTitle,
} from '@/shared/components/ol/ol-modal'

type Props = {
  show: boolean
  title: string
  message: string
  onHide: () => void
  onConfirm: () => void
}

export default function BibDeleteModal({ show, title, message, onHide, onConfirm }: Props) {
  const { t } = useTranslation()
  return (
    <OLModal data-bib-editor-dialog backdrop="static" show={show} onHide={onHide} themed>
      <OLModalHeader closeButton>
        <OLModalTitle>{title}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>{message}</OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide}>{t('cancel')}</OLButton>
        <OLButton variant="danger" onClick={onConfirm}>{t('delete')}</OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
