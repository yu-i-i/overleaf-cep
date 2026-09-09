import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import GithubLogo from '@/shared/svgs/github-logo'
import GitLabLogo from '@/shared/svgs/gitlab-logo'  // Will need to add this
import IntegrationCard from '@/features/integrations-panel/integration-card'
import GitSyncModal from './modals/git-sync-modal'
import { GitSyncModalStatus } from '../types/git-sync-types'

const GitHubSyncCard = () => {
  const { t } = useTranslation()

  const [showModal, setShowModal] = useState(false)
  const { projectId, name } = useProjectContext()
  const [modalStatus, setModalStatus] = useState<GitSyncModalStatus>('loading')
  
  // Get server type from context or default to GitHub
  const [serverType, setServerType] = useState<'github' | 'gitlab' | 'gitea'>('github')

  useEffect(() => {
    // In real implementation, this would fetch the sync state to get server type
    // For now, we default to GitHub which maintains backward compatibility
    const savedState = localStorage.getItem(`git-sync-state-${projectId}`)
    if (savedState) {
      try {
        const state = JSON.parse(savedState)
        if (state.serverType) setServerType(state.serverType)
      } catch { /* ignore */ }
    }
  }, [projectId])

  // Determine icon based on server type
  const icon = () => {
    switch (serverType) {
      case 'gitlab':
        return <GitLabLogo size={32} />
      case 'gitea':
      case 'forgejo':
        // These should use the same logo as GitHub as a fallback
        return <GithubLogo size={32} />
      default:
        return <GithubLogo size={32} />
    }
  }

  // Determine title based on server type
  const title = () => {
    switch (serverType) {
      case 'gitlab': return t('sync_with_gitlab')
      case 'gitea': return t('sync_with_gitea')
      case 'forgejo': return t('sync_with_forgejo')
      default: return t('git_provider')
    }
  }

  // Determine description based on server type
  const description = () => {
    switch (serverType) {
      case 'gitlab': return t('sync_with_a_gitlab_repository')
      case 'gitea': return t('sync_with_a_gitea_repository')
      case 'forgejo': return t('sync_with_a_forgejo_repository')
      default: return t('sync_with_a_github_repository')
    }
  }

  const handleHide = () => {
    setShowModal(false)
    setModalStatus('loading')
  }

  return (
    <>
      <IntegrationCard
        title={title()}
        description={description()}
        icon={icon()}
        showPaywallBadge={false}
        onClick={() => setShowModal(true)}
      >
      </IntegrationCard>
      <GitSyncModal
        show={showModal}
        modalStatus={modalStatus}
        setModalStatus={setModalStatus}
        handleHide={handleHide}
        projectId={projectId}
        projectName={name}
      />
    </>
  )
}

export default GitHubSyncCard
