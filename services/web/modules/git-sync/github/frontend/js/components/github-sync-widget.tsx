import { GitSyncProvider } from '../../../../common/frontend/js/git-sync-provider'
import { githubGitSyncConfig } from '../git-sync-config'
import GitSyncWidget from '../../../../common/frontend/js/components/git-sync-widget'

export function GitHubSyncWidget() {
  return <GitSyncProvider config={githubGitSyncConfig}><GitSyncWidget /></GitSyncProvider>
}
