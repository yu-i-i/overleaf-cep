import { useState } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { type GitSyncConfig, useGitSync, GitSyncProvider } from '../git-sync-provider'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import GitSyncModal from './modals/git-sync-modal'
import { GitSyncModalStatus } from '../types/git-sync-types'

const GitSyncCardContent = () => {
  const { displayTitle, Logo, t } = useGitSync()

  const [showModal, setShowModal] = useState(false)
  const { projectId, name } = useProjectContext()
  const [modalStatus, setModalStatus] = useState<GitSyncModalStatus>('loading')

  return (
    <>
      <IntegrationCard
        title={displayTitle}
        description={t('sync_with_a_github_repository')}
        icon={<Logo size={32} />}
        showPaywallBadge={false}
        onClick={() => setShowModal(true)}
      >
      </IntegrationCard>
      <GitSyncModal
        show={showModal}
        modalStatus={modalStatus}
        setModalStatus={setModalStatus}
        handleHide={() => {
          setShowModal(false)
          setModalStatus('loading')
        }}
        projectId={projectId}
        projectName={name}
      />
    </>
  )
}

export default function GitSyncCard({ config }: { config: GitSyncConfig }) {
  return <GitSyncProvider config={config}><GitSyncCardContent /></GitSyncProvider>
}
