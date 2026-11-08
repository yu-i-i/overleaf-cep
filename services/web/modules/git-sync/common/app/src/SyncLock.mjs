import LockManager from '../../../../../app/src/infrastructure/LockManager.mjs'

const SyncLockManager = LockManager.withTimeout(300)

export function runWithGitSyncLock(projectId, callback) {
  return SyncLockManager.promises.runWithLock('gitSync', projectId, callback)
}
