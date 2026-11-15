import { GitSyncProvider } from '../../../../common/frontend/js/git-sync-provider'
import { gitlabGitSyncConfig } from '../git-sync-config'
import GitSyncWidget from '../../../../common/frontend/js/components/git-sync-widget'

export function GitLabSyncWidget() {
  return <GitSyncProvider config={gitlabGitSyncConfig}><GitSyncWidget /></GitSyncProvider>
}
