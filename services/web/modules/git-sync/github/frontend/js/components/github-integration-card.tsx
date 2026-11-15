import GitSyncCard from '../../../../common/frontend/js/components/git-integration-card'
import { githubGitSyncConfig } from '../git-sync-config'

export default function GitHubSyncCard() {
  return <GitSyncCard config={githubGitSyncConfig} />
}
