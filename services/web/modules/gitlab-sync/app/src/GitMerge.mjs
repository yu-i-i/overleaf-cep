import { normalize } from 'path/posix'
import pLimit from 'p-limit'
import { createHash } from 'crypto'
import logger from '@overleaf/logger'
import SyncStateManager from './SyncStateManager.mjs'
import api from './GitLabApiClient.mjs'
import HistoryManager from './HistoryManager.mjs'
import { GitConflictError } from './GitSyncErrors.mjs'
import TokenManager from './TokenManager.mjs'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import LockManager from '../../../../app/src/infrastructure/LockManager.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import UpdateMerger from '../../../../app/src/Features/ThirdPartyDataStore/UpdateMerger.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'

const SyncLockManager = LockManager.withTimeout(300) // 5 min

export async function doGitMerge(userId, projectId, message, claimConflictIsResolved) {
  return await SyncLockManager.promises.runWithLock(
    'gitSync',
    projectId,
    () => doGitMergeWithoutLock(userId, projectId, message, claimConflictIsResolved)
  )
}

async function doGitMergeWithoutLock(userId, projectId, message, claimConflictIsResolved) {
  const projectSyncState = await SyncStateManager.getProjectState(projectId)
  if (!projectSyncState) throw new GitNotLinkedError(projectId)
  const {
    repoFullName,
    defaultBranchName,
    mergeStatus,
    unmergedBranchName
  } = projectSyncState

  // do nothing if conflict is not yet resolved and 'Sync' button is pushed
  // do nothing if conflict is already resolved and 'I have manually merged' button is pushed
  if (
    !claimConflictIsResolved && mergeStatus === 'conflict' ||
    claimConflictIsResolved && mergeStatus !== 'conflict'
  ) return { mergeStatus, repoFullName, unmergedBranchName }

  const tokens = await TokenManager.getUserToken(userId)
  if (!tokens) throw new InvalidTokenError('no user token', { userId, status: 400 });
  const { token } = tokens

  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

  const currentVersion = await HistoryManager.latestVersion(projectId)
  const defaultBranchHead = await api.getBranchHead(token, repoFullName, defaultBranchName)

  let newUnmergedBranchName

  switch (mergeStatus) {

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
        defaultBranchHead
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
  return { mergeStatus: newMergeStatus, repoFullName, unmergedBranchName: newUnmergedBranchName }
}

// ----------- clean flow
async function resolveCleanSyncState(
  token,
  userId,
  projectSyncState,
  currentVersion,
  defaultBranchHead,
  message,
) {
  const { projectId, repoFullName, defaultBranchName } = projectSyncState

  // No changes in OL
  if (currentVersion === projectSyncState.lastSyncVersion) {
    // No changes in GH too: everything is up to date
    if (projectSyncState.lastSyncCommit === defaultBranchHead) return null

    // Need to apply only GH changes
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })

    await SyncStateManager.updateProjectState(projectId, { lastSyncVersion, lastSyncCommit })
    return null
  }

  // Possible changes in OL
  if (defaultBranchHead === projectSyncState.lastSyncCommit) {
    try {
      const olBranchHead =
        await exportChangesToGit({
          token,
          projectId,
          repoFullName,
          lastSyncVersion: projectSyncState.lastSyncVersion,
          currentVersion,
          message,
          baseCommit: projectSyncState.lastSyncCommit,
          defaultBranchName,
        })
      if (!olBranchHead) { // no real canges in OL, but currentVersion is ahead
        await SyncStateManager.updateProjectState(projectId, { lastSyncVersion: currentVersion })
        return null
      }
      const lastSyncCommit = olBranchHead
      const lastSyncVersion = await applyGitSnapshotToProject({
        token,
        userId,
        projectId,
        repoFullName,
        lastSyncCommit,
      })

      await SyncStateManager.updateProjectState(projectId, { lastSyncVersion, lastSyncCommit })
      return null
    } catch (err) {
      logger.error({ err, projectId }, 'Error during clean sync state resolution, fallback to merge')
    }
  }

  // Git head is ahead of last known sync commit, create a temporary branch with OL changes and perform a merge with the default branch
  const tempBranchName = generateBranchName()
  const olBranchHead =
    await exportChangesToGit({
      token,
      projectId,
      repoFullName,
      lastSyncVersion: projectSyncState.lastSyncVersion,
      currentVersion,
      message,
      baseCommit: projectSyncState.lastSyncCommit,
      branch: tempBranchName,
    })

  // Merge the temporary branch into the default branch
  const { mergeCommit, conflict } = await mergeWithTempBranch(
    token,
    repoFullName,
    defaultBranchName,
    tempBranchName
  )

  if (conflict) {
    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'conflict',
      lastSyncCommit: defaultBranchHead,
      unmergedBranchName: tempBranchName,
      unmergedBranchHead: olBranchHead,
      conflictVersion: currentVersion,
    })
    return tempBranchName
  } else {
    const lastSyncCommit = mergeCommit
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { lastSyncVersion, lastSyncCommit })
    return null
  }
}

// ----------- conflict flow
async function resolveConflictSyncState(
  token,
  userId,
  projectSyncState,
  currentVersion,
  defaultBranchHead
) {
  const { projectId, repoFullName, defaultBranchName, conflictVersion } = projectSyncState

  // No OL changes after manual conflict resolving: pull GH changes only
  if (currentVersion === conflictVersion) {
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })

    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'clean',
      lastSyncVersion,
      lastSyncCommit,
      conflictVersion: null,
      unmergedBranchName: null,
      unmergedBranchHead: null
    })
    return null
  }

  // OL was changed after manual conflict resolution: need to merge
  const prevOlBranchHead = projectSyncState.unmergedBranchHead

  // Create a temporary branch with OL changes after manual conflict resolution
  const tempBranchName = generateBranchName()
  const newOlBranchHead = await exportChangesToGit({
    token,
    projectId,
    repoFullName,
    lastSyncVersion: conflictVersion,
    currentVersion,
    message: '[Updates in Overleaf during conflict resolution]',
    baseCommit: prevOlBranchHead,
    branch: tempBranchName,
  })

  // Were there really any changes? (e.g.: file created, then removed: no changes)
  if (!newOlBranchHead) {
    // nothing to push to GH
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })

    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'clean',
      lastSyncVersion,
      lastSyncCommit,
      conflictVersion: null,
      unmergedBranchName: null,
      unmergedBranchHead: null
    })
    return null
  }

  // merge
  const { mergeCommit, conflict } = await mergeWithTempBranch(
    token,
    repoFullName,
    defaultBranchName,
    tempBranchName
  )

  if (conflict) {
    // conflict must be resolved manually
    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'conflict',
      lastSyncCommit: defaultBranchHead,
      unmergedBranchName: tempBranchName,
      unmergedBranchHead: newOlBranchHead,
      conflictVersion: currentVersion,
    })
    return tempBranchName
  } else {
    // merge succeeded
    const lastSyncCommit = mergeCommit
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'clean',
      lastSyncVersion,
      lastSyncCommit,
      conflictVersion: null,
      unmergedBranchName: null,
      unmergedBranchHead: null
    })
    return null
  }
}

// ----------- detached flow
// GH repo was force pushed, lastSync commit possibly unavailable
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
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'clean', lastSyncVersion, lastSyncCommit })
    return null
  }

  // Need to compare lastSync OL version (base), current OL version (local) and GH version (remote)
  const baseSnapshot = await HistoryManager.getProjectSnapshot(projectId, projectSyncState.lastSyncVersion)
  const localSnapshot = await HistoryManager.getProjectSnapshot(projectId, currentVersion)
  const remoteBlobMap = await getGitBlobMap(token, repoFullName, defaultBranchHead)

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
    remoteBlobMap,
  })

  // were any changes introduced in GH?
  if (!hasChanges) {
    await SyncStateManager.updateProjectState(projectId, {
       mergeStatus: 'clean',
       lastSyncVersion: currentVersion,
       lastSyncCommit: defaultBranchHead
    })
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
    }
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'clean', lastSyncVersion, lastSyncCommit })
    return null
  }

  // Resolve potential conflict.
  // Build synthetic merge topology:
  //
  //              GH
  //             /
  // H --- B ---
  //             \
  //              OL
  //
  // merge(GH <- OL)
  //
  // B: conflicted files are restored to lastSyncVersion (merge base)
  // GH: in conflicted files remote changes after lastSyncVersion are replayed
  // OL: all changes done in Overleaf after lastSyncVersion are applied

  // Blobs referenced in conflictBaseEntries in theory could be lost, but for GitHub,
  // GitLab and Gitea, blobs from historical commits are normally retained for a
  // very long time so the practical probability of failure is likely close to zero.
  // TODO: anyway, if error is thrown by api.createTree, upload all blobs
  // referenced in conflictBaseEntries and try again

  // H --- B
  const baseCommit = await createCommitFromEntries({
    token,
    repoFullName,
    parentCommit: defaultBranchHead,
    entries: conflictBaseEntries,
    message: '[Overleaf GitSync conflict resolution: restore last sync]',
  })

  // default branch: --- H --- B --- GH
  const remoteChangesCommit = await createCommitFromEntries({
    token,
    repoFullName,
    parentCommit: baseCommit,
    entries: conflictRemoteEntries,
    message: '[Overleaf GitSync conflict resolution: replay repo changes]',
  })

  const tempBranchName = generateBranchName()
  // temp branch: --- H --- B --- OL
  const olChangesCommit = await createCommitFromEntries({
    token,
    repoFullName,
    parentCommit: baseCommit,
    entries: [...cleanLocalEntries, ...conflictLocalEntries],
    message,
    branch: tempBranchName,
  })

  // merge: default <- temp (GH <- OL)
  const { mergeCommit, conflict } = await mergeWithTempBranch(
    token,
    repoFullName,
    defaultBranchName,
    tempBranchName
  )

  // auto-merge succeeded, conflicts in editable files were resolved?
  if (!conflict) {
    const lastSyncCommit = mergeCommit
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'clean', lastSyncVersion, lastSyncCommit })
    return null
  }

  // merge failed: must manually resolve conflicts
  await SyncStateManager.updateProjectState(projectId, {
    mergeStatus: 'conflict',
    lastSyncCommit: remoteChangesCommit,
    unmergedBranchName: tempBranchName,
    unmergedBranchHead: olChangesCommit,
    conflictVersion: currentVersion,
  })
  return tempBranchName
}

// ----------- Helpers
async function applyGitSnapshotToProject({ token, userId, projectId, repoFullName, lastSyncCommit }) {

  const invalidFiles = []
  const updates = []
  const deletions = []

  const currentVersion = await HistoryManager.latestVersion(projectId)
  const historySnapshot = await HistoryManager.getProjectSnapshot(projectId, currentVersion)
  const blobMap = await getGitBlobMap(token, repoFullName, lastSyncCommit)
  const blobPaths = new Set()

  for (const [path, sha] of Object.entries(blobMap)) {
    const invalid = validateFileName(path)

    if (invalid) {
      invalidFiles.push(invalid.name)
      continue
    }

    blobPaths.add(path)

    const hstSha = historySnapshot[path]?.data?.hash
    // File at path is not changed, do not touch it
    if (hstSha === sha) continue

    updates.push(path)
  }

  for (const path of Object.keys(historySnapshot)) {
    if (blobPaths.has(path)) continue
    deletions.push(path)
  }

  // TODO: do not silently ignore invalidFiles, inform user about them
  if (invalidFiles.length > 0) {
    logger.warn({ projectId, invalidFiles }, 'Invalid file paths detected at Git server')
  }
  const limit = pLimit(api.maxConcurrency)
  await Promise.all(
    updates.map(path => limit(async () => {
      const stream = await api.getBlobStream(token, repoFullName, lastSyncCommit, path)
      return UpdateMerger.promises.mergeUpdate(userId, projectId, '/' + path, stream, 'gitlab')
    }))
  )
  const localLimit = pLimit(5)
  await Promise.all(
    deletions.map(path => localLimit(() => {
      return UpdateMerger.promises.deleteUpdate(userId, projectId, '/' + path, 'gitlab')
    }))
  )

  return await HistoryManager.latestVersion(projectId)
}

async function buildDetachedSyncPlan({
  token,
  repoFullName,
  projectId,
  currentVersion,
  baseSnapshot,
  localSnapshot,
  remoteBlobMap
}) {
  const cleanLocalEntries = []
  const conflictRemoteEntries = []
  const conflictLocalEntries = []
  const conflictBaseEntries = []

  let hasConflicts = false
  let hasChanges = false

  const allPaths = new Set([
    ...Object.keys(baseSnapshot || {}),
    ...Object.keys(localSnapshot || {}),
    ...Object.keys(remoteBlobMap || {}),
  ])

  for (const path of allPaths) {
    const baseHash = getEntryHash(baseSnapshot[path])
    const localHash = getEntryHash(localSnapshot[path])
    const remoteHash = remoteBlobMap[path] || null

    // OL == GH, do nothing
    if (localHash === remoteHash) continue

    if (baseHash === remoteHash) {
      // changed in OL
      hasChanges = true
      cleanLocalEntries.push({ path, sha: localHash, content: Buffer.from(localSnapshot[path]?.data?.content || '', 'utf8').toString('base64') })
      continue
    }

    if (baseHash === localHash) {
      // changed in GH
      hasChanges = true
      continue
    }
    // conflict: changed both in GH and OL
    hasChanges = true
    hasConflicts = true

    conflictRemoteEntries.push({ path, sha: remoteHash, content: await api.getBlobContent(token, repoFullName, remoteHash) })
    conflictLocalEntries.push({ path, sha: localHash, content: Buffer.from(localSnapshot[path]?.data?.content || '', 'utf8').toString('base64') })
    conflictBaseEntries.push({ path, sha: baseHash, content: Buffer.from(baseSnapshot[path]?.data?.content || '', 'utf8').toString('base64') })
  }
  return {
    cleanLocalEntries,
    conflictRemoteEntries,
    conflictLocalEntries,
    conflictBaseEntries,
    hasConflicts,
    hasChanges,
  }
}

async function createCommitFromEntries({
  token,
  repoFullName,
  parentCommit,
  entries,
  message,
  branch,
}) {
  const baseTree = await api.getCommitTree(token, repoFullName, parentCommit)
  const newTree = await api.createTree(token, repoFullName, entries, baseTree)
  return api.createCommit(token, repoFullName, {
    tree: newTree,
    start_sha: parentCommit,
    message,
    branch,
  })
}

async function mergeWithTempBranch(
  token,
  repoFullName,
  branchName,
  tempBranchName
) {
  try {
    const mergeCommit =
       await api.mergeBranch(token, repoFullName, branchName, tempBranchName)

    return { conflict: false, mergeCommit }

  } catch (err) {
    if (err instanceof GitConflictError) {
      return { conflict: true }
    }
    throw err
  }
}

async function exportChangesToGit({
  token,
  projectId,
  repoFullName,
  lastSyncVersion,
  currentVersion,
  message,
  baseCommit,
  branch,
}) {
  const diff = await HistoryManager.getProjectFileTreeDiff(
    projectId,
    lastSyncVersion,
    currentVersion
  )

  const { paths } = await HistoryManager.getPathsAtVersion(projectId, lastSyncVersion)
  const existedAtLastSync = new Set(paths)

  const deletePaths = new Set()
  const upsertPaths = new Set()

  for (const item of diff) {
    const oldPath = item.pathname

    if (item.operation === 'removed') {
      // it can happen that removed file was created after last sync
      if (existedAtLastSync.has(oldPath)) deletePaths.add(oldPath)
      continue
    }

    if (item.operation === 'renamed') {
      if (existedAtLastSync.has(oldPath)) deletePaths.add(oldPath)
      upsertPaths.add(item.newPathname)
      continue
    }
    if (item.operation === 'added' || item.operation === 'edited') {
      upsertPaths.add(oldPath)
    }
  }
  // if a file is renamed and a new file with the old name is created,
  // then the name will be in both sets, need to exclude it from deletePaths
  for (const path of upsertPaths) {
    if (deletePaths.has(path)) deletePaths.delete(path)
  }

  // this can happen when a file is created and then removed
  if (deletePaths.size === 0 && upsertPaths.size === 0) return null

  const limit = pLimit(api.maxConcurrency)
  const upsertEntries = await Promise.all(
    [...upsertPaths].map(path =>
      limit(async () => {
        const buffer = await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)
        const sha = "DON_T_DELETE" // sha needs to be present so that the file is not detected as a deletion
        return { path, sha, content: buffer }
      })
    )
  )

  const deleteEntries = [...deletePaths].map(path => ({ path, sha: null, content: null }))
  const entries = [...deleteEntries, ...upsertEntries]

  const newCommit = await createCommitFromEntries({
    token,
    repoFullName,
    parentCommit: baseCommit,
    entries,
    message,
    branch,
  })

  return newCommit
}

function generateBranchName() {
  const d = new Date()
  const pad = n => `${n}`.padStart(2, '0')
  return `overleaf-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

async function getGitBlobMap(token, repoFullName, commit) {
  const blobEntries = await api.listBlobsAtCommit(token, repoFullName, commit)
  return Object.fromEntries(
    blobEntries.map(({ path, sha }) => [path, sha])
  )
}

function getEntryHash(entry) {
  if (!entry?.data) return null
  return (
    entry.data.hash ||
    gitBlobShaFromString(entry.data.content)
  )
}

function gitBlobShaFromString(str) {
  if (!str) return null
  const content = Buffer.from(str, 'utf8')
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8')
  const store = Buffer.concat([header, content])

  return createHash('sha1').update(store).digest('hex')
}

function validateFileName(name) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes('\0')
  ) return { name }

  const normalized = normalize(name)

  if (
    normalized !== name ||
    normalized.startsWith('/') ||
    normalized.startsWith('../')
  ) return { name }

  return null
}
