import { useState } from 'react'
import OLButton from '@/shared/components/ol/ol-button'
import { useTranslation } from 'react-i18next'
import RestoreProjectModal from '../../../modals/restore-project-modal'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { useProjectListContext } from '../../../../context/project-list-context'
import { undeleteProject } from '../../../../util/api'
import { Project } from '../../../../../../../types/project/api'

function RestoreProjectsButton() {
  const { t } = useTranslation()
  const {
    selectedProjects,
    toggleSelectedProject,
    updateProjectViewData,
  } = useProjectListContext()
  const [showModal, setShowModal] = useState(false)
  const isMounted = useIsMounted()

  const handleOpenModal = () => {
    setShowModal(true)
  }

  const handleCloseModal = () => {
    if (isMounted.current) {
      setShowModal(false)
    }
  }

  const handleRestoreProject = (project: Project) => {
    return undeleteProject(project.id, project.owner.id).then(data => {
      toggleSelectedProject(project.id, false)
      updateProjectViewData({
        ...project,
        ...data,
        deleted: false,
        trashed: false,
      })
    })
  }

  return (
    <>
      <OLButton variant="primary" onClick={handleOpenModal}>
        {t('restore')}
      </OLButton>
      <RestoreProjectModal
        projects={selectedProjects}
        actionHandler={handleRestoreProject}
        showModal={showModal}
        handleCloseModal={handleCloseModal}
      />
    </>
  )
}

export default RestoreProjectsButton
