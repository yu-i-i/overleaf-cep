export const GitServerTypes = {
  GITHUB: 'github',
  GITLAB: 'gitlab',
  GITEA: 'gitea',
  FORGEJO: 'forgejo'
}

export type GitSyncModalStatus =
    'loading'
  | 'need-export'
  | 'cannot-export'
  | 'need-auth'
  | 'need-permission'
  | 'merge-overview'
  | 'confirm-unlink'
  | 'unlink-unavailable'
  | 'run-merge'
  | 'run-merge-resolved'
  | 'show-conflict'

export type ProjectSyncState = {
  mergeStatus: 'clean' | 'conflict' | 'diverged' | 'need-export' | 'need-permission'
  repoFullName: string
  unmergedBranchName: string | null
  ownerEmail?: string
  syncServerUrl?: string
  syncUsername?: string
}
