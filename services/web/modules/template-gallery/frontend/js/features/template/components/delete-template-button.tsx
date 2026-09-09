import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { useLocation } from '@/shared/hooks/use-location'
import OLButton from '@/shared/components/ol/ol-button'
import DeleteTemplateModal from './modals/delete-template-modal'
import { useTemplateContext } from '../context/template-context'
import { deleteTemplate } from '../util/api'
import type { Template } from '../../../../../types/template'

function DeleteTemplateButton() {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const isMounted = useIsMounted()
  const { template } = useTemplateContext()
  const location = useLocation()

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
    location.assign(previousPage)
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
