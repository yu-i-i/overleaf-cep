import pLimit from 'p-limit'
import { GitConflictError, ProviderRequestError } from './GitSyncErrors.mjs'
import HistoryManager from './HistoryManager.mjs'
import { applyGitSnapshotToProject, getChangedPaths, getEntryHash, getGitBlobMap, matchesDocumentBlob, inspectPullHistory } from './GitMergeHelpers.mjs'

export function createMergeWorkflow({ api, provider, SyncStateManager, createCommitFromEntries, mergeWithTempBranch, resolveDetached }) {
  async function importAndFinish(token, userId, projectId, repoFullName, lastSyncCommit, expectedVersion) {
    const version = await applyGitSnapshotToProject({
      SyncStateManager, api, provider, token, userId, projectId, repoFullName, lastSyncCommit, expectedVersion,
    })
    await SyncStateManager.finishSync(projectId, lastSyncCommit, version)
    return null
  }

  async function recordConflict(projectId, lastSyncCommit, unmergedBranchName, unmergedBranchHead, conflictVersion) {
    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'conflict', pendingPull: null, lastSyncCommit, unmergedBranchName, unmergedBranchHead, conflictVersion,
    })
    return unmergedBranchName
  }

  async function resolveCleanSyncState(token, userId, state, currentVersion, remoteHead, message) {
    const { projectId, repoFullName, defaultBranchName, lastSyncVersion, lastSyncCommit } = state
    const unchanged = remoteHead === lastSyncCommit
    if (unchanged && currentVersion === lastSyncVersion) return null

    let commit = remoteHead
    if (currentVersion !== lastSyncVersion) {
      // A force push can happen between displaying the overview and starting sync.
      if (!unchanged && !await api.isAncestor(token, repoFullName, lastSyncCommit, remoteHead)) {
        return resolveDetached(token, userId, state, currentVersion, remoteHead, message)
      }
      const options = { token, projectId, repoFullName, lastSyncVersion, currentVersion, message, baseCommit: lastSyncCommit }
      const localHead = await exportChangesToGit(options)
      let published = false
      if (localHead && unchanged && api.publishCommit) {
        try {
          await api.publishCommit(token, repoFullName, defaultBranchName, localHead, remoteHead)
          published = true
        } catch (err) {
          if (!(err instanceof GitConflictError)) throw err
          // If the target was rewritten during export, recompute the detached plan.
          const latest = await api.getBranchHead(token, repoFullName, defaultBranchName)
          if (!await api.isAncestor(token, repoFullName, remoteHead, latest)) {
            return resolveDetached(token, userId, state, currentVersion, latest, message)
          }
        }
      }
      if (!localHead && unchanged) {
        await SyncStateManager.finishSync(projectId, lastSyncCommit, currentVersion)
        return null
      }
      if (published && localHead) commit = localHead
      else if (localHead) {
        // Merge the isolated export into the linked branch.
        const result = await mergeWithTempBranch(token, repoFullName, defaultBranchName, localHead)
        if (result.conflict) {
          return recordConflict(projectId, remoteHead, result.tempBranchName, localHead, currentVersion)
        }
        commit = result.mergeCommit
      }
    }

    return importAndFinish(token, userId, projectId, repoFullName, commit, currentVersion)
  }

  async function recoverPendingPull(token, userId, state, currentVersion, defaultBranchHead, resolutionConfirmation) {
    const { pendingPull, projectId, repoFullName } = state
    if (pendingPull.complete) {
      // This immutable checkpoint was already verified. All later edits are pending.
      await SyncStateManager.finishSync(projectId, pendingPull.commit, pendingPull.cursorVersion)
      return null
    }
    const progress = await inspectPullHistory(projectId, pendingPull.cursorVersion, currentVersion, provider)
    if (progress.interleaved) {
      // The overwrite may already have happened. The user must review history
      // and explicitly approve the current OL snapshot before reconciliation.
      requireResolutionConfirmation({
        ...state, recoveryFromVersion: pendingPull.cursorVersion,
        recoveryVersion: currentVersion,
      }, state.defaultBranchName, defaultBranchHead, false, resolutionConfirmation)
    }
    if (progress.concurrent) {
      // Imported files belong to the base snapshot. Only later collaborator
      // edits form the local side of this three-way reconciliation.
      return resolveDetached(
        token, userId, { ...state, lastSyncVersion: progress.version },
        currentVersion, defaultBranchHead, '[Overleaf GitSync: recover interrupted import]'
      )
    }

    return importAndFinish(token, userId, projectId, repoFullName, pendingPull.commit, currentVersion)
  }

  async function baselineMatchesSnapshot(token, repoFullName, commit, projectId, version) {
    const files = await HistoryManager.getProjectSnapshot(projectId, version)
    const blobs = await getGitBlobMap(api, token, repoFullName, commit)
    return Object.keys(files).length === Object.keys(blobs).length &&
      Object.entries(files).every(([path, entry]) => Object.hasOwn(blobs, path) && blobs[path] === getEntryHash(entry))
  }

  async function resolveConflictSyncState(token, userId, projectSyncState, currentVersion, defaultBranchHead, resolutionConfirmation) {
    const { projectId, repoFullName, defaultBranchName, conflictVersion, unmergedBranchHead } = projectSyncState
    const verified = await api.isAncestor(token, repoFullName, unmergedBranchHead, defaultBranchHead)
    requireResolutionConfirmation(projectSyncState, defaultBranchName, defaultBranchHead, verified, resolutionConfirmation)
    if (!verified || currentVersion !== conflictVersion &&
        !await baselineMatchesSnapshot(token, repoFullName, unmergedBranchHead, projectId, conflictVersion)) {
      // Reconcile later OL edits against the OL version at the conflict,
      // retaining the confirmed branch contents as the remote side.
      return resolveDetached(
        token, userId, { ...projectSyncState, lastSyncVersion: conflictVersion },
        currentVersion, defaultBranchHead, '[Overleaf GitSync: manual resolution]'
      )
    }
    let lastSyncCommit = defaultBranchHead
    if (currentVersion !== conflictVersion) {
      const newOlBranchHead = await exportChangesToGit({
        token, projectId, repoFullName, lastSyncVersion: conflictVersion, currentVersion,
        message: '[Updates in Overleaf during conflict resolution]', baseCommit: unmergedBranchHead,
      })
      if (newOlBranchHead) {
        const { conflict, mergeCommit, tempBranchName } = await mergeWithTempBranch(
          token, repoFullName, defaultBranchName, newOlBranchHead
        )
        if (conflict) {
          return recordConflict(projectId, defaultBranchHead, tempBranchName, newOlBranchHead, currentVersion)
        }
        lastSyncCommit = mergeCommit
      }
    }

    return importAndFinish(token, userId, projectId, repoFullName, lastSyncCommit, currentVersion)
  }

  function requireResolutionConfirmation(state, branch, head, verified, confirmation) {
    const resolution = {
      branch, head,
      recoveryFromVersion: state.recoveryFromVersion ?? null,
      recoveryVersion: state.recoveryVersion ?? null,
      linkedBranch: state.defaultBranchName,
      sourceBranch: state.unmergedBranchName,
      sourceCommit: state.unmergedBranchHead,
      conflictVersion: state.conflictVersion,
      lastSyncCommit: state.lastSyncCommit,
      unchanged: head === state.lastSyncCommit,
    }
    const matches = confirmation && Object.keys(resolution).every(key => confirmation[key] === resolution[key])
    if (confirmation ? !matches : !verified) {
      throw new ProviderRequestError('Confirm the manually resolved branch before continuing.', {
        status: 409, key: 'resolution_confirmation_required', resolution,
      })
    }
  }

  async function buildDetachedSyncPlan({
    token,
    repoFullName,
    projectId,
    currentVersion,
    baseSnapshot,
    localSnapshot,
    remoteBlobMap, remoteCommit,
  }) {
    const cleanLocalEntries = []
    const conflictRemoteEntries = []
    const conflictLocalEntries = []
    const conflictBaseEntries = []

    let hasChanges = false

    const allPaths = new Set([
      ...Object.keys(baseSnapshot || {}),
      ...Object.keys(localSnapshot || {}),
      ...Object.keys(remoteBlobMap || {}),
    ])

    for (const path of allPaths) {
      const baseHash = getEntryHash(baseSnapshot[path])
      const localHash = getEntryHash(localSnapshot[path])
      const remoteHash = Object.hasOwn(remoteBlobMap, path) ? remoteBlobMap[path] : null

      if (localHash === remoteHash) continue
      if (localHash === baseHash) {
        hasChanges = true
        continue
      }

      // Compare editor line endings only when the raw remote hash would
      // otherwise imply concurrent edits. Keep real Git hashes in tree entries.
      let remoteUnchanged = remoteHash === baseHash
      if (remoteHash && !remoteUnchanged) {
        const openStream = () => api.getBlobStream(token, repoFullName, remoteCommit, path)
        if (await matchesDocumentBlob(localSnapshot[path], remoteHash, openStream)) continue
        remoteUnchanged = await matchesDocumentBlob(baseSnapshot[path], remoteHash, openStream)
      }

      if (localHash) {
        const content = localSnapshot[path].data.content
        const buffer = content != null
          ? Buffer.from(content, 'utf8').toString('base64')
          : await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)
        await api.uploadBlob(token, repoFullName, buffer)
      }

      hasChanges = true
      if (remoteUnchanged) {
        cleanLocalEntries.push({ path, sha: localHash })
        continue
      }
      conflictRemoteEntries.push({ path, sha: remoteHash })
      conflictLocalEntries.push({ path, sha: localHash })
      conflictBaseEntries.push({ path, sha: baseHash })
    }
    return {
      cleanLocalEntries,
      conflictRemoteEntries,
      conflictLocalEntries,
      conflictBaseEntries,
      hasConflicts: conflictBaseEntries.length > 0,
      hasChanges,
    }
  }

  async function uploadConflictBaseEntries(token, repoFullName, projectId, lastSyncVersion, conflictBaseEntries) {
    const limit = pLimit(api.maxConcurrency)
    await Promise.all(conflictBaseEntries.filter(entry => entry.sha).map(entry => limit(async () => {
      const buffer = await HistoryManager.getProjectFileBuffer(projectId, lastSyncVersion, entry.path)
      await api.uploadBlob(token, repoFullName, buffer)
    })))
  }

  async function exportChangesToGit({
    token,
    projectId,
    repoFullName,
    lastSyncVersion,
    currentVersion,
    message,
    baseCommit,
  }) {
    const diff = await HistoryManager.getProjectFileTreeDiff(
      projectId,
      lastSyncVersion,
      currentVersion
    )

    const { paths } = await HistoryManager.getPathsAtVersion(projectId, lastSyncVersion)
    const { deletePaths, upsertPaths } = getChangedPaths(diff, paths)

    // this can happen when a file is created and then removed
    if (deletePaths.size === 0 && upsertPaths.size === 0) return null

    const limit = pLimit(api.maxConcurrency)
    const upsertEntries = await Promise.all(
      [...upsertPaths].map(path =>
        limit(async () => {
          const buffer = await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)
          const sha = await api.uploadBlob(token, repoFullName, buffer)
          return { path, sha }
        })
      )
    )

    const deleteEntries = [...deletePaths].map(path => ({ path, sha: null }))
    const entries = [...deleteEntries, ...upsertEntries]

    const newCommit = await createCommitFromEntries({
      token,
      repoFullName,
      parentCommit: baseCommit,
      entries,
      message,
    })

    return newCommit === baseCommit ? null : newCommit
  }

  return { importAndFinish, recordConflict, resolveCleanSyncState, recoverPendingPull, resolveConflictSyncState, buildDetachedSyncPlan, uploadConflictBaseEntries }
}
