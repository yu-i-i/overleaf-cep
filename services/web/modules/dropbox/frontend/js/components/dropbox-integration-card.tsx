import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DropboxLogo from './dropbox-logo.tsx'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import { useProjectContext } from '@/shared/context/project-context'
import DropboxSyncModal from './dropbox-sync-modal.tsx'

const DropboxIntegrationCard = () => {
  const { t } = useTranslation()

  const [showModal, setShowModal] = useState(false)
  const { project } = useProjectContext()

  const projectId = project?._id
  if (!projectId) return null

  // Extract relevant project info to pass to modal
  const projectName = project?.name

  return (
    <>
      <IntegrationCard
        title={t('dropbox')}
        description={t('sync_with_dropbox_server')}
        icon={<DropboxLogo size={32} />}
        showPaywallBadge={false}
        onClick={() => setShowModal(true)}
      />
      <DropboxSyncModal
        show={showModal}
        projectId={projectId}
        initialProjectName={projectName}
        handleHide={() => {
          setShowModal(false)
        }}
      />
    </>
  )
}

export default DropboxIntegrationCard
