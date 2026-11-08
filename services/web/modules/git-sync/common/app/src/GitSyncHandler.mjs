import { runWithGitSyncLock } from './SyncLock.mjs'
import Path from 'path'
import fs from 'fs'
import { pipeline } from 'node:stream/promises'
import crypto from 'crypto'
import pLimit from 'p-limit'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import ProjectGetter from '../../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectUploadManager from '../../../../../app/src/Features/Uploads/ProjectUploadManager.mjs'
import UserGetter from '../../../../../app/src/Features/User/UserGetter.mjs'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import HistoryManager from './HistoryManager.mjs'
import { getGitBlobMap, getEntryHash, matchesDocumentBlob } from './GitMergeHelpers.mjs'
import { InvalidTokenError, ExpiredTokenError, NotFoundError, PermissionDeniedError, GitNotLinkedError } from './GitSyncErrors.mjs'

export default function createGitSyncHandler({ api, SyncStateManager, TokenManager, provider }) {
  async function getGitConnState(userId) {
    try {
      const token = await TokenManager.getUserToken(userId)
      await api.getUser(token)
      return true
    } catch (err) {
      if ((err instanceof InvalidTokenError || err instanceof ExpiredTokenError)) {
        logger.debug( { err, userId }, 'token invalid, treating as not connected')
        return false
      }
      throw OError.tag(err, 'failed to validate token', { userId })
    }
  }

  async function getProjectState(userId, projectId) {
    let pss = null
    const projection = { _id: 0, mergeStatus: 1, repoFullName: 1, defaultBranchName: 1, unmergedBranchName: 1 }
    pss = await SyncStateManager.getProjectState(projectId, projection)
    if (!pss) {
      pss = { mergeStatus: 'need-export' }
      try {
        const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
        if (owner_ref.toString() !== userId) {
          pss.ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
        }
      } catch (err) {
        pss.ownerEmail = 'nobody@nowhere'
        logger.error({ err }, "failed get user email")
      }
      return pss
    }
    let canPush
    try {
      const token = await TokenManager.getUserToken(userId)
      canPush = await api.getPushPermission(token, pss.repoFullName, pss.defaultBranchName)
    } catch (err) {
      if ((err instanceof NotFoundError) ||
          (err instanceof PermissionDeniedError)
      ) canPush = false
      else throw err
    }
    if (!canPush) {
      pss.mergeStatus = 'need-permission'
      // send owner's email to collaborator
      // send nothing to the owner
      try {
        const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
        if (owner_ref.toString() !== userId) {
          pss.ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
        }
      } catch (err) {
        logger.error({ err, userId }, "failed get user email")
        pss.ownerEmail = 'nobody@nowhere'
      }
    }
    if (pss.mergeStatus === 'publishing') pss.mergeStatus = 'diverged'
    return pss
  }

  function unlinkRepo(userId, projectId) {
    return runWithGitSyncLock(projectId, () => unlinkRepoWithoutLock(userId, projectId))
  }

  async function unlinkRepoWithoutLock(userId, projectId) {
    const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
    if (owner_ref.toString() !== userId) {
      let ownerEmail
      try {
        ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
      } catch (err) {
        logger.error({ err, userId }, "failed get user email")
        ownerEmail = 'nobody@nowhere'
      }
      return ownerEmail
    }
    await SyncStateManager.removeProjectState(projectId)
    return null
  }


  async function listUserRepos(userId) {
    const token = await TokenManager.getUserToken(userId)
    return await api.listUserRepos(token)
  }

  async function listRepoBranches(userId, repoFullName) {
    const token = await TokenManager.getUserToken(userId)
    return api.listRepoBranches(token, repoFullName)
  }

  async function getUserAndOrgs(userId) {
    const token = await TokenManager.getUserToken(userId)
    return await api.getUserAndOrgs(token)
  }

  async function getMergeOverview(userId, projectId) {
    const projectSyncState = await SyncStateManager.getProjectState(projectId)
    if (!projectSyncState) throw new GitNotLinkedError(projectId)
    const { repoFullName, defaultBranchName, lastSyncCommit, lastSyncVersion, mergeStatus } = projectSyncState

    if (projectSyncState.pendingPull) {
      return { commits: [], diverged: false, isProjectUpdated: true, pendingPull: true }
    }
    if (mergeStatus === 'publishing') return { commits: [], diverged: true, isProjectUpdated: true }
    if (mergeStatus === 'conflict') return null

    // A delayed overview must not replace a conflict or a newer checkpoint.
    const expectedState = {
      _id: projectSyncState._id, mergeStatus, repoFullName, defaultBranchName,
      lastSyncCommit, lastSyncVersion,
    }

    const token = await TokenManager.getUserToken(userId)
    const currentVersion = await HistoryManager.latestVersion(projectId.toString())
    const isProjectUpdated = currentVersion !== lastSyncVersion
    try {
      const commitsAndStatus = await api.listNewCommitsWithStatus(token, repoFullName, defaultBranchName, lastSyncCommit)
      if(commitsAndStatus.diverged) {
        await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' }, expectedState)
      }
      return { ...commitsAndStatus, isProjectUpdated }
    } catch (err) {
      if (err instanceof NotFoundError) {
        // what is the reason of NotFoundError? is it a missing commit or not?
        let canPush
        try {
          canPush = await api.getPushPermission(token, repoFullName, defaultBranchName)
        } catch (e) {
          logger.error({ error: e }, "failed to check push permission")
          canPush = false
        }
        if (!canPush) throw err
        await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' }, expectedState)
        return { commits: [], diverged: true, isProjectUpdated }
      } else {
        throw err
      }
    }
  }

  async function importRepo(userId, projectName, repoFullName, defaultBranchName) {
    const token = await TokenManager.getUserToken(userId)
    const defaultBranchHead = await api.getBranchHead(token, repoFullName, defaultBranchName)
    const fsPath = Path.join(Settings.path.dumpFolder, `${provider}_import_${crypto.randomUUID()}`)

    let project_id

    try {
      const stream = await api.getRepoZipball(token, repoFullName, defaultBranchHead)
      await pipeline(stream, fs.createWriteStream(fsPath))

      const { project } = await ProjectUploadManager.promises.createProjectFromZipArchiveWithName(
        userId,
        projectName,
        fsPath
      )

      project_id = project?._id
    } catch (err) {
      throw OError.tag(
        err,
        'failed importing git repo',
        { userId, projectName, repoFullName, defaultBranchName, fsPath }
      )
    } finally {
      fs.promises.rm(fsPath, { force: true }).catch(() => {})
    }

    const imported = {
      projectId: project_id.toString(), userId: userId.toString(),
      repoFullName, defaultBranchName, lastSyncCommit: defaultBranchHead, lastSyncVersion: null,
    }
    return linkImportedProject(userId, imported)
  }

  async function linkImportedProject(userId, imported, retry = false) {
    const { projectId, repoFullName, defaultBranchName, lastSyncCommit } = imported
    try {
      return await runWithGitSyncLock(projectId, async () => {
        if (retry) {
          const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
          if (owner_ref.toString() !== userId.toString()) throw new Error('Project ownership changed')
          const existing = await SyncStateManager.getProjectState(projectId)
          if (existing) {
            if (existing.repoFullName !== repoFullName || existing.defaultBranchName !== defaultBranchName) {
              throw new Error('Project is already linked to another repository or branch')
            }
            return { projectId, linked: true }
          }
        }
        if (imported.lastSyncVersion == null) {
          const version = await HistoryManager.latestVersion(projectId)
          if (!Number.isSafeInteger(version) || version < 0) throw new Error('Invalid project version')
          if (retry) {
            // The initial history read failed. A later version is a safe
            // checkpoint only if it still represents the downloaded commit.
            const token = await TokenManager.getUserToken(userId)
            const blobs = await getGitBlobMap(api, token, repoFullName, lastSyncCommit)
            const files = await HistoryManager.getProjectSnapshot(projectId, version)
            if (Object.keys(blobs).length !== Object.keys(files).length) throw new Error('Imported project changed')
            for (const [path, sha] of Object.entries(blobs)) {
              if (!Object.hasOwn(files, path) || (getEntryHash(files[path]) !== sha &&
                  !await matchesDocumentBlob(files[path], sha, () => api.getBlobStream(token, repoFullName, lastSyncCommit, path)))) {
                throw new Error('Imported project changed')
              }
            }
          }
          imported.lastSyncVersion = version
        }
        await SyncStateManager.createProjectState(projectId, {
          repoFullName, defaultBranchName, mergeStatus: 'clean', lastSyncCommit,
          lastSyncVersion: imported.lastSyncVersion,
        })
        return { projectId, linked: true }
      })
    } catch (err) {
      logger.error({ err, projectId, repoFullName }, 'Project was imported but linking failed')
      return { projectId, linked: false, imported }
    }
  }

  function exportProject(userId, projectId, repoOptions) {
    return runWithGitSyncLock(projectId, () => exportProjectWithoutLock(userId, projectId, repoOptions))
  }

  async function exportProjectWithoutLock(userId, projectId, repoOptions) {
    const isLinked = await SyncStateManager.getProjectState(projectId)
    if (isLinked) {
      throw new OError('Project is already linked to Git server', { projectId })
    }

    const name = repoOptions.name
    // conservative common rule
    if (typeof name !== 'string' || name.length > 100 ||
      !/^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(name) ||
      /\.(git|wiki|atom)$/i.test(name)
    ) {
      throw new OError('Invalid repository name', { status: 400, key: 'github_sync_invalid_repository_name' })
    }

    const branchName = typeof repoOptions.branchName === 'string' ? repoOptions.branchName.trim() : ''
    if (!branchName ||
      branchName.length > 100 ||
      branchName === '@' ||
      branchName === 'HEAD' ||
      branchName.startsWith('-') ||
      branchName.endsWith('.') ||
      branchName.includes('..') ||
      branchName.includes('@{') ||
      /[\x00-\x20\x7f~^:?*\[\]\\\s]/.test(branchName) ||
      branchName.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))
    ) {
      throw new OError('Invalid Git branch name', { status: 400, key: 'github_sync_invalid_branch_name' })
    }

    const token = await TokenManager.getUserToken(userId)

    await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

    const currentVersion = await HistoryManager.latestVersion(projectId)
    const currentPaths = await HistoryManager.getPathsAtVersion(projectId, currentVersion)
    if (api.createsEmptyRepo && currentPaths.paths.length === 0) {
      throw new Error(`Cannot export an empty Overleaf project to ${api.providerName}`)
    }

    const repo = await api.createRepo(token, repoOptions)
    const repoFullName = repo.fullName

    const limit = pLimit(api.maxConcurrency)
    const blobData = await Promise.all(
      currentPaths.paths.map((path) =>
        limit(async () => {
          const buffer = await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)
          const sha = await api.uploadBlob(token, repoFullName, buffer)
          return { path, sha }
        })
      )
    )

    const tree = await api.createTree(token, repoFullName, blobData)
    const initialCommit = await api.createCommit(token, repoFullName, {
      tree,
      message: 'Initial Overleaf import',
      branch: branchName,
      initial: api.createsEmptyRepo === true,
    })

    await api.publishInitialCommit?.(token, repo, branchName, initialCommit)

    return SyncStateManager.createProjectState(projectId, {
      mergeStatus: 'clean',
      defaultBranchName: branchName,
      lastSyncCommit: initialCommit,
      lastSyncVersion: currentVersion,
      repoFullName,
    })
  }

  return {
    exportProject,
    getProjectState,
    unlinkRepo,
    importRepo,
    linkImportedProject,
    getGitConnState,
    listUserRepos,
    listRepoBranches,
    getUserAndOrgs,
    getMergeOverview,
  }
}
