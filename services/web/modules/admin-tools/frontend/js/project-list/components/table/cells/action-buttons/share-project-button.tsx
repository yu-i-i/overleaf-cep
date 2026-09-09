import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { Project } from '../../../../../../types/project/api'
import ShareProjectModal from '../../../modals/share-project-modal'

type ShareProjectButtonProps = {
  project: Project
  children: (text: string, handleOpenModal: () => void) => React.ReactElement
}

function ShareProjectButton({ project, children }: ShareProjectButtonProps) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const isMounted = useIsMounted()

  const handleOpenModal = useCallback(() => {
    setShowModal(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    if (isMounted.current) {
      setShowModal(false)
    }
  }, [isMounted])

  if (project.deleted) return null

  const text = t('admin_share_title')

  return (
    <>
      {children(text, handleOpenModal)}
      {showModal && (
        <ShareProjectModal
          project={project}
          showModal={showModal}
          handleCloseModal={handleCloseModal}
        />
      )}
    </>
  )
}

const ShareProjectButtonTooltip = memo(function ShareProjectButtonTooltip({
  project,
}: Pick<ShareProjectButtonProps, 'project'>) {
  return (
    <ShareProjectButton project={project}>
      {(text, handleOpenModal) => (
        <OLTooltip
          key={`tooltip-share-project-${project.id}`}
          id={`share-project-${project.id}`}
          description={text}
          overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
        >
          <OLIconButton
            onClick={handleOpenModal}
            variant="link"
            accessibilityLabel={text}
            className="action-btn"
            icon="person_add"
          />
        </OLTooltip>
      )}
    </ShareProjectButton>
  )
})

export default ShareProjectButton
export { ShareProjectButtonTooltip }
