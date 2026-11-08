import GitSyncCard from '../../../../common/frontend/js/components/git-integration-card'
import { gitlabGitSyncConfig } from '../git-sync-config'

export default function GitLabSyncCard() {
  return <GitSyncCard config={gitlabGitSyncConfig} />
}
