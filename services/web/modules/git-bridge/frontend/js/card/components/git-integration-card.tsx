import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { OLModal } from '@/shared/components/ol/ol-modal'
import IntegrationCard from '@/features/integrations-panel/integration-card.tsx'
import GitLogoOrange from '@/shared/svgs/git-logo-orange'
import GitModal from './git-modal'

function GitSyncCard() {
  const { t } = useTranslation()
  const { project } = useProjectContext()
  const [show, setShow] = useState(false)

  const projectId = project?._id
  if (!projectId) return null

  return (
    <>
      <IntegrationCard
        title={t('git')}
        description={t('git_clone_this_project')}
        icon={<GitLogoOrange size={32} />}
        onClick={() => setShow(true)}
      />

      <GitModal
        show={show}
        projectId={projectId}
        handleHide={() => setShow(false)}
      />
    </>
  )
}

export default GitSyncCard
