import { createMergeWorkflow } from './GitMergeWorkflow.mjs'
import { createTemporaryBranches } from './TemporaryBranches.mjs'
import createSyncStateManager from './SyncStateManager.mjs'
import { GitSyncProjectStates } from '../models/gitSyncProjectStates.mjs'
import HistoryManager from './HistoryManager.mjs'
import { getGitBlobMap } from './GitMergeHelpers.mjs'
import { GitConflictError, GitNotLinkedError, ProviderRequestError } from './GitSyncErrors.mjs'
import createTokenManager from './TokenManager.mjs'
import { runWithGitSyncLock } from './SyncLock.mjs'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'

export function createGitMerge(api, provider) {
  const SyncStateManager = createSyncStateManager(GitSyncProjectStates, provider)
  const TokenManager = createTokenManager(provider, api)

  const { mergeWithTempBranch, createBranch, deleteBranchBestEffort } = createTemporaryBranches(api)

  const mergeWorkflow = createMergeWorkflow({
    api, provider, SyncStateManager, createCommitFromEntries, mergeWithTempBranch,
    resolveDetached: resolveDetachedSyncState,
  })
  const { importAndFinish, recordConflict, resolveConflictSyncState, resolveCleanSyncState, buildDetachedSyncPlan, uploadConflictBaseEntries } = mergeWorkflow


  async function doGitMerge(userId, projectId, message, claimConflictIsResolved, resolutionConfirmation) {
    return await runWithGitSyncLock(
      projectId,
      () => {
        const run = () => doGitMergeWithoutLock(userId, projectId, message, claimConflictIsResolved, resolutionConfirmation)
        return api.withTemporaryBranches ? api.withTemporaryBranches(run) : run()
      }
    )
  }

  async function doGitMergeWithoutLock(userId, projectId, message, claimConflictIsResolved, resolutionConfirmation) {
    const projectSyncState = await SyncStateManager.getProjectState(projectId)
    if (!projectSyncState) throw new GitNotLinkedError(projectId)
    if (projectSyncState.detachedMergeBranchName && projectSyncState.mergeStatus === 'conflict') {
      throw new ProviderRequestError('Finish the existing staging-branch conflict with the previous GitSync version before upgrading.', { status: 409 })
    }
    const {
      repoFullName,
      defaultBranchName,
      mergeStatus,
      unmergedBranchName
    } = projectSyncState

    // do nothing if conflict is not yet resolved and 'Sync' button is pushed
    // do nothing if conflict is already resolved and 'I have manually merged' button is pushed
    if (
      !projectSyncState.pendingPull && (
        !claimConflictIsResolved && mergeStatus === 'conflict' ||
        claimConflictIsResolved && mergeStatus !== 'conflict'
      )
    ) return { mergeStatus, repoFullName, defaultBranchName, unmergedBranchName }

    const token = await TokenManager.getUserToken(userId)

    await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

    const currentVersion = await HistoryManager.latestVersion(projectId)
    const defaultBranchHead = await api.getBranchHead(token, repoFullName, defaultBranchName)

    let newUnmergedBranchName

    if (projectSyncState.pendingPull) {
      newUnmergedBranchName = await mergeWorkflow.recoverPendingPull(
        token, userId, projectSyncState, currentVersion, defaultBranchHead, resolutionConfirmation
      )
    } else switch (mergeStatus) {

      case 'publishing':
        newUnmergedBranchName = await resumePublication(token, userId, projectSyncState, currentVersion, true)
        break

      case 'clean':
        newUnmergedBranchName = await resolveCleanSyncState(
          token,
          userId,
          projectSyncState,
          currentVersion,
          defaultBranchHead,
          message,
        )
        break

      case 'conflict':
        newUnmergedBranchName = await resolveConflictSyncState(
          token,
          userId,
          projectSyncState,
          currentVersion,
          defaultBranchHead,
          resolutionConfirmation
        )
        break

      case 'diverged':
        newUnmergedBranchName = await resolveDetachedSyncState(
          token,
          userId,
          projectSyncState,
          currentVersion,
          defaultBranchHead,
          message,
        )
        break

      default:
        throw new Error('Bad mergeStatus')
    }

    const newMergeStatus = newUnmergedBranchName ? 'conflict' : 'clean'
    return { mergeStatus: newMergeStatus, repoFullName, defaultBranchName, unmergedBranchName: newUnmergedBranchName }
  }

  // Publish the synthetic remote history to the linked branch.
  async function resolveDetachedSyncState(
    token,
    userId,
    projectSyncState,
    currentVersion,
    defaultBranchHead,
    message,
  ) {
    const { projectId, repoFullName, defaultBranchName } = projectSyncState

    // No changes in OL: re-anchor
    if (currentVersion === projectSyncState.lastSyncVersion) {
      return importAndFinish(token, userId, projectId, repoFullName, defaultBranchHead, currentVersion)
    }

    // Need to compare lastSync OL version (base), current OL version (local) and linked Git version (remote)
    const baseSnapshot = await HistoryManager.getProjectSnapshot(projectId, projectSyncState.lastSyncVersion)
    const localSnapshot = await HistoryManager.getProjectSnapshot(projectId, currentVersion)
    const remoteBlobMap = await getGitBlobMap(api, token, repoFullName, defaultBranchHead)

    const {
      cleanLocalEntries,
      conflictRemoteEntries,
      conflictLocalEntries,
      conflictBaseEntries,
      hasConflicts,
      hasChanges
    } = await buildDetachedSyncPlan({
      token,
      repoFullName,
      projectId,
      currentVersion,
      baseSnapshot,
      localSnapshot,
      remoteBlobMap, remoteCommit: defaultBranchHead,
    })

    // Identical snapshots can share a checkpoint immediately.
    if (!hasChanges) {
      await SyncStateManager.finishSync(projectId, defaultBranchHead, currentVersion)
      return null
    }

    if (!hasConflicts) {
      let lastSyncCommit = defaultBranchHead
      if (cleanLocalEntries.length !== 0) {
        lastSyncCommit = await createCommitFromEntries({
          token,
          repoFullName,
          parentCommit: defaultBranchHead,
          entries: cleanLocalEntries,
          message,
        })
        if (api.publishCommit) {
          await api.publishCommit(token, repoFullName, defaultBranchName, lastSyncCommit, defaultBranchHead)
        } else {
          const merged = await mergeWithTempBranch(token, repoFullName, defaultBranchName, lastSyncCommit)
          if (merged.conflict) {
            return recordConflict(projectId, defaultBranchHead, merged.tempBranchName, lastSyncCommit, currentVersion)
          }
          lastSyncCommit = merged.mergeCommit
        }
      }
      return importAndFinish(token, userId, projectId, repoFullName, lastSyncCommit, currentVersion)
    }

    // Resolve potential conflict.
    // Build synthetic merge topology:
    //
    //              Git
    //             /
    // H --- B ---
    //             \
    //              OL
    //
    // merge(Git <- OL)
    //
    // B: conflicted files are restored to lastSyncVersion (merge base)
    // Git: in conflicted files remote changes after lastSyncVersion are replayed
    // OL: all changes done in Overleaf after lastSyncVersion are applied

    await uploadConflictBaseEntries(token, repoFullName, projectId, projectSyncState.lastSyncVersion, conflictBaseEntries)

    // H --- B
    const baseCommit = await createCommitFromEntries({
      token,
      repoFullName,
      parentCommit: defaultBranchHead,
      entries: conflictBaseEntries,
      message: '[Overleaf GitSync conflict resolution: restore last sync]',
    })

    // H --- B --- Git
    const remoteChangesCommit = await createCommitFromEntries({
      token,
      repoFullName,
      parentCommit: baseCommit,
      entries: conflictRemoteEntries,
      message: '[Overleaf GitSync conflict resolution: replay repo changes]',
    })

    // H --- B --- OL
    const olChangesCommit = await createCommitFromEntries({
      token,
      repoFullName,
      parentCommit: baseCommit,
      entries: [...cleanLocalEntries, ...conflictLocalEntries],
      message,
    })

    // The synthetic remote tip must exactly reproduce the original Git tree,
    // including executable bits, symlinks and submodule entries.
    const [originalTree, replayedTree] = await Promise.all(
      [defaultBranchHead, remoteChangesCommit].map(sha => api.getTreeIdentity(token, repoFullName, sha))
    )
    if (!originalTree || originalTree !== replayedTree) {
      throw new ProviderRequestError('Git could not reproduce the linked tree exactly. Check file modes and path conflicts.', { status: 409 })
    }

    if (!api.publishCommit) {
      // Pin the three commits before changing the linked branch. Each REST
      // merge has a meaningful diff, including on GitLab. The ordinary source
      // branch is also the name used for manual resolution.
      const source = await createBranch(token, repoFullName, olChangesCommit)
      await api.createBranch(token, repoFullName, source + '-base', baseCommit)
      await api.createBranch(token, repoFullName, source + '-remote', remoteChangesCommit)
      if (await api.getBranchHead(token, repoFullName, defaultBranchName) !== defaultBranchHead) {
        await deleteBranchBestEffort(token, repoFullName, source, olChangesCommit)
        await deleteBranchBestEffort(token, repoFullName, source + '-base', baseCommit)
        await deleteBranchBestEffort(token, repoFullName, source + '-remote', remoteChangesCommit)
        throw new ProviderRequestError('The linked branch moved. Sync again to include its changes.', {
          status: 409,
          key: 'github_sync_linked_branch_moved',
        })
      }
      const publication = { mergeStatus: 'publishing', pendingPull: null, lastSyncCommit: remoteChangesCommit,
        unmergedBranchName: source, unmergedBranchHead: olChangesCommit, conflictVersion: currentVersion }
      await SyncStateManager.updateProjectState(projectId, publication)
      return resumePublication(token, userId, { ...projectSyncState, ...publication }, currentVersion)
    }

    // default branch: --- H --- B --- Git
    await api.publishCommit(
      token,
      repoFullName,
      defaultBranchName,
      remoteChangesCommit,
      defaultBranchHead
    )

    // temp branch: --- H --- B --- OL
    // merge: default <- temp (Git <- OL)
    const { mergeCommit, tempBranchName, conflict } = await mergeWithTempBranch(
      token,
      repoFullName,
      defaultBranchName,
      olChangesCommit
    )

    // auto-merge succeeded, conflicts in editable files were resolved?
    if (!conflict) {
      return importAndFinish(token, userId, projectId, repoFullName, mergeCommit, currentVersion)
    }

    // merge failed: must manually resolve conflicts
    return recordConflict(projectId, remoteChangesCommit, tempBranchName, olChangesCommit, currentVersion)
  }

  async function resumePublication(token, userId, state, currentVersion, retry = false) {
    const { projectId, repoFullName, defaultBranchName, unmergedBranchName: source,
      unmergedBranchHead: local, lastSyncCommit: remote } = state
    // Read the immutable parent from the prepared remote commit so an edited
    // recovery branch cannot change which commit we integrate.
    const base = await api.getFirstParent(token, repoFullName, remote)
    let head = await api.getBranchHead(token, repoFullName, defaultBranchName)
    for (const [branch, sha] of [[source + '-base', base], [source + '-remote', remote], [source, local]]) {
      if (await api.isAncestor(token, repoFullName, sha, head)) continue
      if (await api.getBranchHead(token, repoFullName, branch) !== sha) {
        throw new ProviderRequestError(`Restore branch ${branch} to ${sha} before continuing sync.`, { status: 409 })
      }
      try {
        head = await api.mergeBranch(token, repoFullName, defaultBranchName, branch, sha, retry)
      } catch (err) {
        if (!(err instanceof GitConflictError)) throw err
        if (branch !== source) {
          throw new ProviderRequestError(`Merge ${branch} into ${defaultBranchName}, then sync again to finish restoring the repository changes.`, {
            status: 409,
            key: 'github_sync_merge_recovery_branch',
            translationOptions: { branch, targetBranch: defaultBranchName },
          })
        }
        await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'conflict', lastSyncCommit: head })
        await deleteBranchBestEffort(token, repoFullName, source + '-base', base)
        await deleteBranchBestEffort(token, repoFullName, source + '-remote', remote)
        return source
      }
    }
    // Save the normal continuation before importing. It also reconciles
    // Overleaf edits that arrived between publication attempts.
    await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'conflict', lastSyncCommit: head })
    await deleteBranchBestEffort(token, repoFullName, source + '-base', base)
    await deleteBranchBestEffort(token, repoFullName, source + '-remote', remote)
    await deleteBranchBestEffort(token, repoFullName, source, local)
    return resolveConflictSyncState(token, userId, { ...state, lastSyncCommit: head }, currentVersion, head)
  }

  // ----------- Helpers
  async function createCommitFromEntries({
    token,
    repoFullName,
    parentCommit,
    entries,
    message,
  }) {
    const baseTree = await api.getCommitTree?.(token, repoFullName, parentCommit)
    const newTree = await api.createTree(token, repoFullName, entries, baseTree)
    return api.createCommit(token, repoFullName, {
      tree: newTree,
      parents: [parentCommit],
      message,
    })
  }

  return doGitMerge
}
