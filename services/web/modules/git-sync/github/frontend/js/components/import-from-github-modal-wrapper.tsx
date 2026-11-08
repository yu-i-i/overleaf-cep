import ImportFromGitModal from '../../../../common/frontend/js/components/import-from-git-modal-wrapper'
import { githubGitSyncConfig } from '../git-sync-config'

export default function ImportFromGitHubModal({ onHide }: { onHide: () => void }) {
  return <ImportFromGitModal config={githubGitSyncConfig} onHide={onHide} />
}
