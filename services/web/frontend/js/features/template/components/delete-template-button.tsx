import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import OLButton from '@/features/ui/components/ol/ol-button'
import DeleteTemplateModal from './delete-template-modal'
import { Template } from '../../../../../types/template'
import { useTemplateContext } from '../context/template-context'
import { deleteTemplate } from '@/features/template/util/api'

function DeleteTemplateButton() {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const isMounted = useIsMounted()
  const { template, setTemplate } = useTemplateContext()

  const handleOpenModal = () => {
    setShowModal(true)
  }

  const handleCloseModal = () => {
    if (isMounted.current) {
      setShowModal(false)
    }
  }

  const handleDeleteTemplate = async (template: Template) => {
    await deleteTemplate(template)
    handleCloseModal()
    const previousPage = document.referrer || '/templates'
    window.location.href = previousPage
  }

  return (
    <>
      <OLButton variant="danger" onClick={handleOpenModal}>
        {t('delete')}
      </OLButton>
      <DeleteTemplateModal
        template={template}
        actionHandler={handleDeleteTemplate}
        showModal={showModal}
        handleCloseModal={handleCloseModal}
      />
    </>
  )
}

export default DeleteTemplateButton
