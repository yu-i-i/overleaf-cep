import React from 'react'
import { GitSyncProvider } from '../../../../common/frontend/js/git-sync-provider'
import { gitlabGitSyncConfig } from '../git-sync-config'
import ImportFromGitMenu from '../../../../common/frontend/js/components/import-from-git-menu'

export default function ImportFromGitLabMenu({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return <GitSyncProvider config={gitlabGitSyncConfig}><ImportFromGitMenu onClick={onClick} /></GitSyncProvider>
}
