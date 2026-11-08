import GitSyncCard from '../../../../common/frontend/js/components/git-integration-card'
import { giteaGitSyncConfig } from '../git-sync-config'

export default function GiteaSyncCard() {
  return <GitSyncCard config={giteaGitSyncConfig} />
}
