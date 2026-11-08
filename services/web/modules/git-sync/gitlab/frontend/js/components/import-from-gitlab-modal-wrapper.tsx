import ImportFromGitModal from '../../../../common/frontend/js/components/import-from-git-modal-wrapper'
import { gitlabGitSyncConfig } from '../git-sync-config'

export default function ImportFromGitLabModal({ onHide }: { onHide: () => void }) {
  return <ImportFromGitModal config={gitlabGitSyncConfig} onHide={onHide} />
}
