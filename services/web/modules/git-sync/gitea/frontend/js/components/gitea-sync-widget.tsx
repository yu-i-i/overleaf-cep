import { GitSyncProvider } from '../../../../common/frontend/js/git-sync-provider'
import { giteaGitSyncConfig } from '../git-sync-config'
import GitSyncWidget from '../../../../common/frontend/js/components/git-sync-widget'

export function GiteaSyncWidget() {
  return <GitSyncProvider config={giteaGitSyncConfig}><GitSyncWidget /></GitSyncProvider>
}
