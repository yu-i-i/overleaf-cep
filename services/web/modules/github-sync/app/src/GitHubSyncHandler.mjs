import Path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectUploadManager from '../../../../app/src/Features/Uploads/ProjectUploadManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import GitServerClient from './GitServerClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import HistoryManager from './HistoryManager.mjs'
import TokenManager from './TokenManager.mjs'
import { writeStoredZip } from './ZipWriter.mjs'
import { InvalidTokenError, NotFoundError, GitNotLinkedError } from './GitSyncErrors.mjs'

const gitClient = new GitServerClient()

// githubinterface confines all working directories to its own work root
// (both processes run in the same container, so the shared path below must
// match that root; default <tmpdir>/ghif on both sides).
const GHIF_WORK_ROOT = process.env.GITHUBINTERFACE_WORKDIR_ROOT || Path.join(os.tmpdir(), 'ghif')

// identity used for commits pushed on behalf of the user
const COMMIT_IDENTITY = { name: 'Overleaf Sync', email: 'overleaf-sync@localhost' }

function defaultServerUrl(provider) {
  const fromSettings = Settings?.githubSync?.serverUrl
  if (provider === 'github' && fromSettings) return fromSettings.replace(/\/$/, '')
  const envByProvider = {
    gitlab: 'https://gitlab.com',
    gitea: 'https://codeberg.org',
    forgejo: 'https://codeberg.org'
  }
  return envByProvider[provider] || 'https://github.com'
}

/**
 * Resolve the credentials (token, serverUrl, username) to use for a
 * provider. Falls back to defaults when no server is stored for the
 * provider.
 */
async function resolveCreds(userId, provider, serverUrl, usernameHint) {
  const prov = provider || 'github'

  const allServers = await TokenManager.getPublicServers(userId)
  let url = (serverUrl || '').replace(/\/$/, '')
  if (!url) {
    const first = allServers.find(s => s.provider === prov)
    url = first ? first.url : defaultServerUrl(prov)
  }

  // Username may be omitted when exactly one account is stored for
  // (provider, url); with several, TokenManager raises a clear 400 instead
  // of silently picking any account. For github.com the dedicated OAuth slot
  // is the fallback account.
  const wantUsername = (usernameHint || '').trim() || undefined
  const creds = await TokenManager.getUserPATCredentials(userId, prov, url, wantUsername)
  return { ...creds, provider: prov }
}

async function getGitConnState(userId) {
  try {
    const providers = await TokenManager.getPublicServers(userId)
    const oauth = await TokenManager.getOAuth(userId)
    return {
      connected: providers.length > 0 || oauth.linked,
      providers,
      oauth
    }
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      logger.debug({ err, userId }, 'no linked servers, treating as not connected')
      return { connected: false, providers: [], oauth: { linked: false, username: '' } }
    }
    throw OError.tag(err, 'failed to get connection state', { userId })
  }
}

async function getProjectState(userId, projectId) {
  let pss = null
  const projection = { _id: 0, mergeStatus: 1, repoFullName: 1, unmergedBranchName: 1, syncProvider: 1, syncServerUrl: 1, syncUsername: 1 }
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
      logger.error({ err }, 'failed get user email')
    }
    return pss
  }

  // Resolve credentials stored with the project state
  const { repoFullName, syncProvider, syncServerUrl, syncUsername } = pss
  let creds
  try {
    creds = await resolveCreds(userId, syncProvider, syncServerUrl, syncUsername)
  } catch (err) {
    logger.warn({ err, userId, projectId }, 'no stored credentials for project state')
    return pss
  }

  try {
    const canPush = await gitClient.canPush(repoFullName, creds.serverUrl, creds.username, creds.token)
    if (!canPush) {
      pss.mergeStatus = 'need-permission'
      try {
        const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
        if (owner_ref.toString() !== userId) {
          pss.ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
        }
      } catch (err) {
        logger.error({ err, userId }, 'failed get user email')
        pss.ownerEmail = 'nobody@nowhere'
      }
    }
  } catch (err) {
    logger.error({ err }, 'failed to check push permission')
  }

  return pss
}

async function unlinkRepo(userId, projectId) {
  const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
  if (owner_ref.toString() !== userId) {
    let ownerEmail
    try {
      ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
    } catch (err) {
      logger.error({ err }, 'failed get user email')
      ownerEmail = 'nobody@nowhere'
    }
    return ownerEmail
  }
  await SyncStateManager.removeProjectState(projectId)
  return null
}

async function listUserRepos(userId, provider, serverUrl, username) {
  const creds = await resolveCreds(userId, provider, serverUrl, username)
  return await gitClient.listRepos(creds.serverUrl, creds.username, creds.token)
}

async function getUserAndOrgs(userId, provider, serverUrl, username) {
  const creds = await resolveCreds(userId, provider, serverUrl, username)
  return await gitClient.listUserAndOrgs(creds.serverUrl, creds.username, creds.token)
}

async function getMergeOverview(userId, projectId) {
  const projectSyncState = await SyncStateManager.getProjectState(projectId)
  if (!projectSyncState) throw new GitNotLinkedError(projectId)
  const { repoFullName, defaultBranchName, lastSyncCommit, lastSyncVersion, mergeStatus, syncProvider, syncServerUrl, syncUsername } = projectSyncState

  if (mergeStatus === 'conflict') return null

  // H15: no baseline yet (import from an empty repo stores lastSyncCommit null)
  // — nothing to compare against, so report "no divergence" instead of calling
  // the commits API with an empty sha.
  if (!lastSyncCommit) {
    return { commits: [], diverged: false, isProjectUpdated: false }
  }

  const creds = await resolveCreds(userId, syncProvider, syncServerUrl, syncUsername)
  const currentVersion = await HistoryManager.latestVersion(projectId.toString())
  const isProjectUpdated = currentVersion !== lastSyncVersion

  try {
    const commitsAndStatus = await gitClient.getCommitsWithStatus(
      repoFullName,
      defaultBranchName,
      lastSyncCommit,
      creds.serverUrl,
      creds.username,
      creds.token
    )

    if (commitsAndStatus.diverged) {
      await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' })
    }
    return { ...commitsAndStatus, isProjectUpdated }
  } catch (err) {
    if (err instanceof NotFoundError) {
      let canPush
      try {
        canPush = await gitClient.canPush(repoFullName, creds.serverUrl, creds.username, creds.token)
      } catch (e) {
        logger.error({ error: e }, 'failed to check push permission')
        canPush = false
      }
      if (canPush) {
        await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' })
        return { commits: [], diverged: true, isProjectUpdated }
      }
      throw Object.assign(new InvalidTokenError('Repository not found', { status: 404 }), { status: 404 })
    }
    throw err
  }
}

async function importRepo(userId, projectName, repoFullName, defaultBranchName, provider, serverUrl, username) {
  const creds = await resolveCreds(userId, provider, serverUrl, username)

  // H15: the repo may be EMPTY (no refs) — resolving the branch head throws in
  // that case. Importing an empty repo is still valid: continue with a null
  // baseline and let the empty-clone path below create the blank project.
  let defaultBranchHead = null
  try {
    defaultBranchHead = await gitClient.getBranchHead(
      repoFullName,
      defaultBranchName,
      creds.serverUrl,
      creds.username,
      creds.token
    )
  } catch (err) {
    logger.warn(
      { err, userId, repoFullName, defaultBranchName },
      'could not resolve branch head (empty repo or no access); continuing with null baseline'
    )
  }
  const fsPath = Path.join(GHIF_WORK_ROOT, `github_import_${crypto.randomUUID()}`)
  const zipPath = `${fsPath}.zip`

  let project_id

  try {
    // Clone the repo to a shared work-directory (githubinterface requires
    // paths inside its work root). Use the BRANCH NAME, not the head SHA:
    // `git clone --branch=<sha>` is not supported by GitHub (the clone in
    // githubinterface maps ref -> --branch), and the branch-name clone
    // already lands on defaultBranchHead anyway. The SHA is kept as the
    // import baseline for the divergence tracking.
    await gitClient.clone(
      repoFullName,
      defaultBranchName || undefined,
      fsPath,
      creds.serverUrl,
      creds.username,
      creds.token
    )

    // GS-05: createProjectFromZipArchiveWithName requires a ZIP file, so zip
    // the cloned working tree (excluding .git) before project creation.
    const zipInfo = await writeStoredZip(fsPath, zipPath, { ignore: /^\.git(\/|$)/ })

    if (zipInfo.entryCount === 0) {
      // Empty repository: a zero-entry zip is rejected by the unzip pipeline
      // (verified against ArchiveManager), so create a plain blank project.
      const project = await ProjectCreationHandler.promises.createBlankProject(
        userId,
        projectName,
        {}
      )
      project_id = project._id
    } else {
      const { project } = await ProjectUploadManager.promises.createProjectFromZipArchiveWithName(
        userId,
        projectName,
        zipPath
      )

      project_id = project?._id
    }
  } catch (err) {
    throw OError.tag(
      err,
      'failed importing git repo',
      { userId, projectName, repoFullName, defaultBranchName, fsPath }
    )
  } finally {
    fs.promises.rm(fsPath, { force: true, recursive: true }).catch(() => {})
    fs.promises.rm(zipPath, { force: true }).catch(() => {})
  }

  try {
    const projectVersion = await HistoryManager.latestVersion(project_id.toString())

    await SyncStateManager.createProjectState(project_id, {
      repoFullName,
      mergeStatus: 'clean',
      lastSyncCommit: defaultBranchHead,
      defaultBranchName,
      lastSyncVersion: projectVersion,
      syncProvider: creds.provider,
      syncServerUrl: creds.serverUrl,
      syncUsername: creds.username,
      ownerId: userId
    })
  } catch (err) {
    logger.error(
      { err, userId, projectId: project_id.toString(), repoFullName },
      'Failed to create state of imported repo'
    )
  }

  return project_id
}

async function exportProject(userId, projectId, repoOptions) {
  const isLinked = await SyncStateManager.getProjectState(projectId)
  if (isLinked) {
    throw new OError('Project is already linked to Git server', { projectId })
  }

  const creds = await resolveCreds(
    userId,
    repoOptions?.provider,
    repoOptions?.serverUrl,
    repoOptions?.username
  )

  const result = await gitClient.createRepo(repoOptions, creds.serverUrl, creds.username, creds.token)
  const { full_name: repoFullName, default_branch: defaultBranchName } = result

  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

  const currentVersion = await HistoryManager.latestVersion(projectId)
  const currentPaths = await HistoryManager.getPathsAtVersion(projectId, currentVersion)

  const fsPath = Path.join(GHIF_WORK_ROOT, `github_export_${crypto.randomUUID()}`)

  try {
    await gitClient.clone(repoFullName, 'HEAD', fsPath, creds.serverUrl, creds.username, creds.token)

    // GS-01: /commit only stages paths that already exist on disk — write
    // every project file (at its latest version) into the working tree first.
    const fileDataList = []
    for (const path of currentPaths.paths) {
      const contentBase64 = await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)
      const dest = Path.join(fsPath, path)
      await fs.promises.mkdir(Path.dirname(dest), { recursive: true })
      await fs.promises.writeFile(dest, Buffer.from(contentBase64, 'base64'))
      fileDataList.push({ path })
    }

    const firstCommit = await gitClient.commit(
      fsPath,
      fileDataList,
      'Initial Overleaf import',
      COMMIT_IDENTITY,
      creds.serverUrl,
      creds.username,
      creds.token
    )

    await gitClient.push(fsPath, 'origin', defaultBranchName, creds.serverUrl, creds.username, creds.token)

    // GS-06: persist a real commit sha so the next divergence check works
    let lastSyncCommit = firstCommit?.commit_sha || firstCommit?.sha || null
    if (!lastSyncCommit) {
      try {
        lastSyncCommit = await gitClient.getBranchHead(
          repoFullName, defaultBranchName, creds.serverUrl, creds.username, creds.token
        )
      } catch (err) {
        logger.warn({ err, repoFullName }, 'could not resolve branch head after export')
      }
    }

    return SyncStateManager.createProjectState(projectId, {
      mergeStatus: 'clean',
      defaultBranchName,
      lastSyncCommit,
      lastSyncVersion: currentVersion,
      repoFullName,
      syncProvider: creds.provider,
      syncServerUrl: creds.serverUrl,
      syncUsername: creds.username,
      ownerId: userId
    })
  } finally {
    fs.promises.rm(fsPath, { force: true, recursive: true }).catch(() => {})
  }
}

export default {
  exportProject,
  getProjectState,
  unlinkRepo,
  importRepo,
  getGitConnState,
  listUserRepos,
  getUserAndOrgs,
  getMergeOverview,
}
