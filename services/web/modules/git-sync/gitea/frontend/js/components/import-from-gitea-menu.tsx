import React from 'react'
import { GitSyncProvider } from '../../../../common/frontend/js/git-sync-provider'
import { giteaGitSyncConfig } from '../git-sync-config'
import ImportFromGitMenu from '../../../../common/frontend/js/components/import-from-git-menu'

export default function ImportFromGiteaMenu({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return <GitSyncProvider config={giteaGitSyncConfig}><ImportFromGitMenu onClick={onClick} /></GitSyncProvider>
}
