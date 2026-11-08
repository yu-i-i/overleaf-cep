import ImportFromGitModal from '../../../../common/frontend/js/components/import-from-git-modal-wrapper'
import { giteaGitSyncConfig } from '../git-sync-config'

export default function ImportFromGiteaModal({ onHide }: { onHide: () => void }) {
  return <ImportFromGitModal config={giteaGitSyncConfig} onHide={onHide} />
}
