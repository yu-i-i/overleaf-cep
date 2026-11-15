import React from 'react'
import { GitSyncProvider } from '../../../../common/frontend/js/git-sync-provider'
import { githubGitSyncConfig } from '../git-sync-config'
import ImportFromGitMenu from '../../../../common/frontend/js/components/import-from-git-menu'

export default function ImportFromGitHubMenu({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return <GitSyncProvider config={githubGitSyncConfig}><ImportFromGitMenu onClick={onClick} /></GitSyncProvider>
}
