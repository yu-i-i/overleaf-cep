import { encryptToken, decryptToken } from './DropboxCredentials.mjs'
import { DropboxUserCredentials } from '../models/dropboxUserCredentials.mjs'
import { DropboxSyncProjectStates } from '../models/dropboxSyncProjectStates.mjs'
import DropboxClient, { isSyncExcluded } from './DropboxClient.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { Readable } from 'node:stream'

const { ensureUserCanWriteProjectContent } = AuthorizationMiddleware
const DEFAULT_DROPBOX_PATH = '/'
const LEGACY_DROPBOX_PATH = 'Overleaf Dev'

// C1: content hash (hex) of the EXACT bytes that last entered the project via
// this integration (or, for local content, the bytes currently in the project).
const sha256 = data => createHash('sha256').update(data).digest('hex')

// C1: normalize a project-relative key (strip leading slashes) for lookups.
const normKey = p => String(p || '').replace(/^\/+/, '')

// Mirror-sync decision helpers (pure, exported for unit tests). Both lanes
// produce the SAME final state: after Export the remote folder contains
// exactly the local (non-excluded) set; after Import the project contains
// exactly the remote (non-excluded) set.

/**
 * Remote keys that must be DELETED on Export: present remotely, absent from
 * the local set, and not sync-excluded. Keys are compared slash-insensitive.
 * @param {string[]} remoteKeys remote file keys (any slash style)
 * @param {string[]} localKeys local entity keys (any slash style)
 * @param {(key: string) => boolean} isExcluded
 * @returns {string[]} sorted slash-less keys to delete
 */
export function remoteOnlyPaths(remoteKeys, localKeys, isExcluded = () => false) {
  const local = new Set((localKeys || []).map(normKey))
  return [...new Set(remoteKeys || [])]
    .map(normKey)
    .filter(k => k && !local.has(k) && !isExcluded(k))
    .sort()
}

/**
 * Local keys that must be DELETED on Import: absent from the remote set, with
 * no remote file anywhere underneath them (so a directory containing kept
 * files is never removed), and not sync-excluded. The project root ("/") is
 * never a target — deleteUpdate("/") soft-deletes the whole project.
 * @param {string[]} localKeys local entity keys (any slash style)
 * @param {string[]} remoteFileKeys remote FILE keys (any slash style)
 * @param {(key: string) => boolean} isExcluded
 * @returns {string[]} sorted slash-less keys to delete
 */
export function localOnlyPaths(localKeys, remoteFileKeys, isExcluded = () => false) {
  const remote = (remoteFileKeys || []).map(normKey)
  const hasRemoteUnder = p => remote.some(k => k.startsWith(`${p}/`))
  return [...new Set(localKeys || [])]
    .map(normKey)
    .filter(k => {
      if (!k || k === '/') return false
      if (remote.includes(k)) return false
      if (hasRemoteUnder(k)) return false
      return !isExcluded(k)
    })
    .sort()
}

/**
 * Import apply decision (remote folder wins): apply the remote file unless
 * all of these hold — the local entity is still present, the remote rev is
 * unchanged since the last sync, and the local content is unchanged since
 * that sync (churn guard only). A locally-deleted file is therefore
 * re-applied, and a remotely-changed file always wins.
 * @param {object} p
 * @param {boolean} p.localPresent local entity exists right now
 * @param {string|null} p.previousRev stored remote rev baseline
 * @param {string|null} p.currentRev current remote rev
 * @param {string|null} p.storedHash stored local-content hash baseline
 * @param {string|null} p.currentHash current local content hash
 * @returns {boolean}
 */
export function shouldApplyRemoteFile({ localPresent, previousRev, currentRev, storedHash, currentHash }) {
  if (!localPresent) return true
  if (
    previousRev &&
    currentRev &&
    previousRev === currentRev &&
    storedHash &&
    currentHash === storedHash
  ) {
    return false
  }
  return true
}

/**
 * Incremental push (2026-08-19): Dropbox's list metadata is NOT a raw
 * content hash — the live API returns `content_hash`, which is not a plain
 * SHA-256 of the bytes (verified in production: byte-identical content,
 * different hash values), so it cannot be compared against a locally
 * computed sha256. The reliable mechanism is the one the import lane already
 * uses: the per-file baseline recorded at last sync (remote rev at that time,
 * local content hash at that time) versus the current state:
 *   skip the upload ⟺ remote rev unchanged since last sync
 *                     AND local content unchanged since last sync
 * Any doubt (no baseline, rev changed, content changed, malformed values)
 * uploads as before — local still wins, and the mirror guarantee is
 * unchanged.
 * @param {string|null|undefined} p.storedRev baseline remote rev (state doc)
 * @param {string|null|undefined} p.currentRev current remote rev (pre-push list)
 * @param {string|null|undefined} p.storedLocalHash baseline local content sha256
 * @param {string} p.currentLocalHash sha256 of the local bytes now
 * @returns {boolean} true → skip the upload
 */
export function shouldSkipDropboxPush({ storedRev, currentRev, storedLocalHash, currentLocalHash }) {
  if (!storedRev || !currentRev || storedRev !== currentRev) return false
  if (!storedLocalHash || !currentLocalHash) return false
  return String(storedLocalHash).toLowerCase() === String(currentLocalHash).toLowerCase()
}

/**
 * BUG1 (user-reported: modal showed "/A5 test" but the files live in
 * "Apps/Overleaf Dev/A5 test"): combine the owner's configured root folder
 * (credentials doc `path`, e.g. "Apps/Overleaf Dev" — may be percent-encoded)
 * with the project state path (e.g. "/A5 test") into the full path exactly as
 * it appears in the Dropbox UI: no leading slash, spaces decoded.
 * A root of "/" or empty yields the state path alone (a plain sandbox root
 * has no displayable name the API exposes).
 * @param {string|null|undefined} rootPath credentials.path
 * @param {string|null|undefined} statePath project state path ("/<project>[/…]")
 * @returns {string}
 */
export function joinDisplayPath(rootPath, statePath) {
  let stateClean = String(statePath || '').replace(/^\/+/, '')
  try {
    stateClean = decodeURIComponent(stateClean)
  } catch {
    // keep as-is on malformed percent-encoding
  }
  if (!stateClean) return ''
  let rootClean = String(rootPath || '').replace(/^\/+|\/+$/g, '')
  try {
    rootClean = decodeURIComponent(rootClean)
  } catch {
    // keep as-is on malformed percent-encoding
  }
  if (!rootClean) return stateClean
  return `${rootClean}/${stateClean}`
}

export function resolveDisplayRoot(activePath, legacyPath, fallback = 'Apps/Overleaf Dev') {
  const configured = activePath || legacyPath
  return configured && configured !== '/' ? configured : fallback
}

function normalizeDropboxPath(path) {
  if (path === '/Overleaf/Dropbox' || !path) return DEFAULT_DROPBOX_PATH
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep malformed custom paths unchanged.
  }
  return path === LEGACY_DROPBOX_PATH ? DEFAULT_DROPBOX_PATH : path
}

function joinDropboxPath(...parts) {
  const path = parts
    .filter(Boolean)
    .map(part => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return path ? `/${path}` : '/'
}

function relativeDropboxPath(projectPath, entry) {
  const prefix = `${projectPath.replace(/^\//, '')}/`
  const remotePath = entry.relative_path || entry.path_display || entry.name
  const relativePath = remotePath.startsWith(prefix)
    ? remotePath.slice(prefix.length)
    : entry.name
  return `/${relativePath.replace(/^\/+/, '')}`
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function ensureDropboxDirectory(client, directoryPath) {
  const parts = directoryPath.split('/').filter(Boolean)
  let currentPath = ''
  for (const part of parts) {
    currentPath = joinDropboxPath(currentPath, part)
    await client.createDirectory(currentPath)
  }
}

export async function uploadProjectToDropbox({
  client,
  projectId,
  rootPath,
  // Current remote snapshot (pre-push list): path → { rev, ... }
  remoteFiles = {},
  // Stored baseline from the last sync (state doc remoteFiles): path → { rev, localHash }
  baselines = {},
}) {
  const project = await ProjectGetter.promises.getProject(projectId, { name: true })
  if (!project) throw new Error('Project not found')

  const projectPath = joinDropboxPath(rootPath, project.name)

  // C4 (bugfix 2026-08-18): flush pending document updates BEFORE reading
  // content — without this, a document that was just edited (e.g. main.tex)
  // can be read in stale form and the STALE body silently overwrites the
  // Dropbox copy (observed in production: "main.tex was changed but the
  // update didn't show up on Dropbox"). Mirrors the WebDAV push lane, which
  // performs this flush before its getAllDocs/getAllFiles read.
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

  const [docs, files] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])

  // D2: sync file filter — excluded files must never be pushed (nor counted).
  const localDocs = Object.fromEntries(
    Object.entries(docs).filter(([p]) => !isSyncExcluded(p))
  )
  const localFilesList = Object.fromEntries(
    Object.entries(files).filter(([p]) => !isSyncExcluded(p))
  )

  // Mirror export: the local (non-excluded) file set is the source of truth.
  // Incremental (2026-08-19): a file is skipped when the remote rev is
  // unchanged since the last sync AND the local content is unchanged since
  // the last sync (see shouldSkipDropboxPush). Any doubt uploads (local wins).
  // Entity keys carry a leading slash; callers pass either key style — the
  // lookups below are slash-tolerant for both maps.
  const canonicalKey = p => `/` + normKey(p)
  const lookupMeta = (p, map = {}) => {
    const k = normKey(p)
    return map[`/` + k] || map[k] || null
  }

  let uploadedFiles = 0
  let skippedFiles = 0
  // C1: sha256 of each file's content AS PUSHED — becomes the stored
  // localHash baseline for the "unchanged?" skip. Recorded for skipped files
  // too: that content is unchanged, so the baseline still holds.
  const localHashes = {}
  // Directory creation is idempotent on Dropbox, but a full-project push
  // previously re-issued the mkdir chain for EVERY file (~2 calls/file). Only
  // directories of actually-uploaded files need creating/refreshing, deduped.
  const ensuredDirectories = new Set()
  const ensureUploadedDirectoryOnce = async directoryPath => {
    if (!directoryPath || ensuredDirectories.has(directoryPath)) return
    ensuredDirectories.add(directoryPath)
    await ensureDropboxDirectory(client, directoryPath)
  }

  const shouldSkip = filePath => {
    const base = lookupMeta(filePath, baselines)
    const cur = lookupMeta(filePath, remoteFiles)
    return shouldSkipDropboxPush({
      storedRev: base?.rev || null,
      currentRev: cur?.rev || null,
      storedLocalHash: base?.localHash || null,
      currentLocalHash: localHashes[canonicalKey(filePath)],
    })
  }

  for (const [filePath, doc] of Object.entries(localDocs)) {
    const text = doc.lines.join('\n')
    localHashes[canonicalKey(filePath)] = sha256(text)
    if (shouldSkip(filePath)) {
      skippedFiles += 1
      continue
    }
    const remotePath = joinDropboxPath(projectPath, filePath)
    await ensureUploadedDirectoryOnce(remotePath.split('/').slice(0, -1).join('/'))
    await client.upload(remotePath, Buffer.from(text).toString('base64'))
    uploadedFiles += 1
  }

  for (const [filePath, file] of Object.entries(localFilesList)) {
    const { stream } = await HistoryManager.promises.requestBlobWithProjectId(
      projectId,
      file.hash
    )
    const content = await streamToBuffer(stream)
    localHashes[canonicalKey(filePath)] = sha256(content)
    if (shouldSkip(filePath)) {
      skippedFiles += 1
      continue
    }
    const remotePath = joinDropboxPath(projectPath, filePath)
    await ensureUploadedDirectoryOnce(remotePath.split('/').slice(0, -1).join('/'))
    await client.upload(remotePath, content.toString('base64'))
    uploadedFiles += 1
  }

  return {
    projectPath,
    projectName: project.name,
    uploadedFiles,
    skippedFiles,
    localHashes,
    // Local entity set (non-excluded), for the push route's remote-only
    // deletion: after this call the remote folder must contain exactly these.
    localPaths: [...Object.keys(localDocs), ...Object.keys(localFilesList)],
  }
}

function isTextFile(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return (Settings.textExtensions || []).includes(extension)
}

function isDropboxNotFound(error) {
  // Typed status first (DropboxClient errors carry the HTTP status); the
  // message fallback keeps compatibility with other error sources.
  if (error?.status === 404) return true
  return /not found/i.test(error?.message || '')
}

/**
 * Per-project sync lock (DBX-04): serializes pull/push/conflict-resolution
 * for a project so concurrent operations cannot tear the state doc or
 * interleave remote list/replace sequences.
 */
const dropboxRefreshLocks = new Map()

/**
 * Recover a valid Dropbox access token after an expiry 401.
 *
 * Dropbox OAuth2 access tokens are short-lived (hours); the OAuth callback
 * (token_access_type=offline) also receives a refresh_token, which we store
 * (encrypted). When the caller's token is rejected, rotate the pair via
 * api.dropboxapi.com/oauth2/token, persist both new tokens, and return the
 * new access token. Dropbox INVALIDATES the old refresh token on rotation,
 * so refreshes are serialized per user and a concurrent refresh that already
 * rotated the pair is detected (stored token != caller's token) and reused
 * instead of replaying the stale refresh token.
 *
 * Throws with `reauthRequired: true` when no refresh token is stored (legacy
 * connections) — the caller should tell the user to reconnect.
 */
export async function getFreshDropboxAccessToken(userId, oldToken) {
  const appKey = process.env.DROPBOX_APP_KEY
  const appSecret = process.env.DROPBOX_APP_SECRET

  const key = String(userId)
  const previous = dropboxRefreshLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => {
    release = resolve
  })
  dropboxRefreshLocks.set(key, current)
  try {
    await previous.catch(() => {})
    const doc = (await DropboxUserCredentials.findOne({ userId })) || null
    if (!doc) throw new Error('Dropbox credentials not found')

    let currentToken = null
    try {
      currentToken = doc.accessToken ? decryptToken(doc.accessToken) : null
    } catch (decryptError) {
      logger.warn(
        { userId },
        'Dropbox stored access token failed to decrypt; attempting refresh'
      )
      currentToken = null
    }

    // A concurrent refresh already rotated the store — reuse the new token
    // WITHOUT replaying the (now invalid) refresh token.
    if (currentToken && currentToken !== oldToken) return currentToken

    if (!doc.refreshToken) {
      throw Object.assign(
        new Error('Dropbox connection expired and no refresh token is stored'),
        { reauthRequired: true }
      )
    }
    if (!appKey || !appSecret) {
      throw Object.assign(
        new Error('Dropbox app key/secret not configured'),
        { reauthRequired: true }
      )
    }

    const refreshToken = decryptToken(doc.refreshToken)
    const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })
    const tokenData = await tokenResponse.json().catch(() => null)
    if (!tokenResponse.ok || !tokenData?.access_token) {
      throw new Error(
        `Dropbox token refresh failed: ${tokenResponse.status} ${
          tokenData?.error_summary || ''
        }` .trim(),
      )
    }

    const $set = { accessToken: encryptToken(tokenData.access_token) }
    // Dropbox returns a rotated refresh token with each refresh; persist it
    if (tokenData.refresh_token) {
      $set.refreshToken = encryptToken(tokenData.refresh_token)
    }
    await DropboxUserCredentials.findOneAndUpdate({ userId }, { $set })
    logger.info({ userId }, 'Dropbox access token refreshed')
    return tokenData.access_token
  } finally {
    release()
    if (dropboxRefreshLocks.get(key) === current) {
      dropboxRefreshLocks.delete(key)
    }
  }
}

const projectSyncLocks = new Map()
async function withProjectSyncLock(projectId, task) {
  const key = projectId.toString()
  const previous = projectSyncLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => {
    release = resolve
  })
  projectSyncLocks.set(key, current)
  try {
    await previous.catch(() => {})
    return await task()
  } finally {
    release()
    if (projectSyncLocks.get(key) === current) projectSyncLocks.delete(key)
  }
}

function normalizeDropboxPathMap(map = {}) {
  // Normalize keys to NO leading slash
  const out = {}
  for (const [path, metadata] of Object.entries(map || {})) {
    out[path.startsWith('/') ? path.slice(1) : path] = metadata
  }
  return out
}

function toRemoteFilesArray(remoteFiles = {}) {
  if (Array.isArray(remoteFiles)) return remoteFiles
  if (remoteFiles instanceof Map) remoteFiles = Object.fromEntries(remoteFiles)
  return Object.entries(remoteFiles).map(([path, metadata]) => ({
    path,
    ...metadata,
  }))
}

export async function importProjectFromDropbox({
  client,
  projectId,
  userId,
  rootPath,
  legacyRootPath,
  previousRemoteFiles = null,
}) {
  const project = await ProjectGetter.promises.getProject(projectId, { name: true })
  if (!project) throw new Error('Project not found')

  let projectPath = joinDropboxPath(rootPath, project.name)
  let listing
  let remoteFolderMissing = false
  try {
    listing = await client.list(projectPath, { recursive: true })
  } catch (err) {
    if (!isDropboxNotFound(err)) throw err
    if (legacyRootPath) {
      const legacyProjectPath = joinDropboxPath(legacyRootPath, project.name)
      try {
        projectPath = legacyProjectPath
        listing = await client.list(projectPath, { recursive: true })
      } catch (legacyError) {
        if (!isDropboxNotFound(legacyError)) throw legacyError
        // Folder missing on BOTH the configured root and the legacy root:
        // the remote project folder does not exist. Propagate a not-found
        // error so the caller (pull route) aborts WITHOUT touching local
        // content — an empty listing would otherwise be read as "the remote
        // folder is empty" and the mirror deletion would wipe the project.
        remoteFolderMissing = true
        listing = { entries: [] }
      }
    } else {
      remoteFolderMissing = true
      listing = { entries: [] }
    }
  }
  const entries = (listing.entries || []).filter(
    entry => entry.type === 'file' && !isSyncExcluded(relativeDropboxPath(projectPath, entry))
  )
  const remoteFiles = Object.fromEntries(
    entries.map(entry => [
      relativeDropboxPath(projectPath, entry),
      {
        rev: entry.rev,
        size: entry.size,
        modifiedAt: entry.client_modified || entry.server_modified,
        localHash: previousRemoteFiles?.[relativeDropboxPath(projectPath, entry)]?.localHash || null,
      },
    ])
  )

  // Mirror import: the REMOTE folder is the source of truth.
  //  - every remote file is (re-)applied, unless the remote rev is unchanged
  //    since last sync AND the local content is unchanged AND the local entity
  //    still exists (skip only that case, to avoid needless revision churn);
  //    a locally-deleted file is therefore re-applied (remote wins);
  //  - local entries that are not part of the remote set are deleted below.
  const [localDocsRaw, localFilesRaw] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])
  // Entity keys carry a leading slash; normalize so lookups are
  // format-independent (the old code compared slash-less keys against
  // slash-carrying maps and silently never matched).
  const localDocs = Object.fromEntries(
    Object.entries(localDocsRaw || {}).map(([k, v]) => [normKey(k), v])
  )
  const localFilesMap = Object.fromEntries(
    Object.entries(localFilesRaw || {}).map(([k, v]) => [normKey(k), v])
  )
  const localKeys = new Set([...Object.keys(localDocs), ...Object.keys(localFilesMap)])
  const currentLocalHash = relKey => {
    if (localDocs && relKey in localDocs) {
      return sha256((localDocs[relKey]?.lines || []).join('\n'))
    }
    if (localFilesMap && relKey in localFilesMap) {
      return localFilesMap[relKey]?.hash || null
    }
    return null
  }

  let importedFiles = 0
  let skippedUnchanged = 0
  const temporaryFiles = []

  try {
    for (const entry of entries) {
      const remotePath = entry.relative_path || entry.path_display
      const relativePath = relativeDropboxPath(projectPath, entry)
      const relKey = normKey(relativePath)
      const previous =
        previousRemoteFiles?.[relativePath] || previousRemoteFiles?.[relKey] || null

      // Churn guard only (the ONLY skip): remote unchanged since last sync
      // AND local unchanged AND local entity still present → skip. Note:
      // Dropbox's list `content_hash` is NOT comparable to a locally computed
      // sha256 (verified in production: identical bytes, different values),
      // so the skip is based on our stored rev + localHash baselines only.
      // Everything else APPLIES (remote wins): changed remote, locally-
      // deleted, no baseline.
      if (!shouldApplyRemoteFile({
        localPresent: localKeys.has(relKey),
        previousRev: previous?.rev || null,
        currentRev: entry.rev || null,
        storedHash: previous?.localHash || null,
        currentHash: localKeys.has(relKey) ? currentLocalHash(relKey) : null,
      })) {
        skippedUnchanged += 1
        continue
      }

      const result = await client.download(`/${remotePath}`)
      if (!result?.content_base64) {
        throw new Error(`Dropbox returned no content for ${remotePath}`)
      }
      const content = Buffer.from(result.content_base64, 'base64')

      // C1: hash of the EXACT content about to enter the project (text = utf8
      // bytes, binary = raw bytes) — becomes the new stored localHash.
      const appliedHash = isTextFile(relativePath)
        ? sha256(content.toString('utf8'))
        : sha256(content)

      if (isTextFile(relativePath)) {
        await EditorController.promises.upsertDocWithPath(
          projectId,
          relativePath,
          content.toString('utf8').split('\n'),
          'dropbox',
          userId
        )
      } else {
        const temporaryFile = path.join(
          os.tmpdir(),
          `overleaf-dropbox-${Date.now()}-${importedFiles}`
        )
        temporaryFiles.push(temporaryFile)
        await fs.writeFile(temporaryFile, content)
        await EditorController.promises.upsertFileWithPath(
          projectId,
          relativePath,
          temporaryFile,
          null,
          'dropbox',
          userId
        )
      }
      importedFiles += 1
      if (remoteFiles[relativePath]) {
        remoteFiles[relativePath] = { ...remoteFiles[relativePath], localHash: appliedHash }
      } else {
        remoteFiles[relativePath] = { path: relativePath, localHash: appliedHash }
      }
    }
  } finally {
    await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true })))
  }

  // Mirror deletion: local-only entries (not present in the remote set, and
  // with no remote file anywhere underneath them) are removed. Excluded
  // entries are never touched; the project root ("/") is never a target —
  // deleteUpdate(path = "/") soft-deletes the whole project. Never runs when
  // the remote folder itself is missing (remoteFolderMissing).
  const remoteRelKeys = entries.map(entry => normKey(relativeDropboxPath(projectPath, entry)))
  let deletedLocal = 0
  if (!remoteFolderMissing) {
    for (const key of localOnlyPaths([...localKeys], remoteRelKeys, isSyncExcluded)) {
      const p = `/${key}`
      try {
        await TpdsUpdateHandler.promises.deleteUpdate(
          userId,
          String(project._id),
          project.name,
          p,
          'dropbox'
        )
        deletedLocal += 1
      } catch (error) {
        logger.warn(
          { err: error, path: p },
          'Dropbox import: failed to delete local-only entry'
        )
      }
    }
  }

  return { projectPath, importedFiles, skippedUnchanged, deletedLocal, remoteFiles, remoteFolderMissing }
}

async function importNewProjectFromDropbox({
  client,
  userId,
  projectName,
  rootPath,
  projectId,
}) {
  const projectPath = joinDropboxPath(rootPath, projectName)
  const listing = await client.list(projectPath, { recursive: true })
  const allEntries = (listing.entries || []).filter(entry => entry.type === 'file')
  // Import-into-EXISTING project (projectId set): same filters + safety gates
  // as pull. Fresh project import (no projectId): filter only.
  const entries = allEntries.filter(
    entry => !isSyncExcluded(relativeDropboxPath(projectPath, entry))
  )
  let importedFiles = 0
  for (const entry of entries) {
    const relativePath = relativeDropboxPath(projectPath, entry)
    const remotePath = entry.relative_path || entry.path_display
    // Mirror semantics (remote folder wins): import the remote content into
    // the existing project; no per-file conflict state is generated anymore.
    const result = await client.download(`/${remotePath}`)
    if (!result?.content_base64) {
      throw new Error(`Dropbox returned no content for ${remotePath}`)
    }
    const content = Buffer.from(result.content_base64, 'base64')
    // DBX-13: keep the SAME text-vs-binary classification as the
    // link/pull flows (upsertDoc for text, upsertFile for binary).
    if (projectId && isTextFile(relativePath)) {
      await EditorController.promises.upsertDocWithPath(
        projectId,
        relativePath,
        content.toString('utf8').split('\n'),
        'dropbox',
        userId
      )
    } else if (projectId) {
      const temporaryFile = path.join(
        os.tmpdir(),
        `overleaf-dropbox-import-${Date.now()}-${importedFiles}`
      )
      await fs.writeFile(temporaryFile, content)
      await EditorController.promises.upsertFileWithPath(
        projectId,
        relativePath,
        temporaryFile,
        null,
        'dropbox',
        userId
      )
      await fs.rm(temporaryFile, { force: true })
    } else {
      await TpdsUpdateHandler.promises.newUpdate(
        userId,
        null,
        projectName,
        relativePath,
        Readable.from([Buffer.from(result.content_base64, 'base64')]),
        'dropbox'
      )
    }
    importedFiles += 1
  }
  return { importedFiles }
}

async function getDropboxRemoteFiles(client, projectPath) {
  const listing = await client.list(projectPath, { recursive: true })
  return Object.fromEntries(
    (listing.entries || [])
      .filter(entry => entry.type === 'file')
      .map(entry => [relativeDropboxPath(projectPath, entry), {
        rev: entry.rev,
        // Incremental push: Dropbox's per-file content hash (SHA-256). The
        // classic JSON field is `hash`; the newer spec also exposes
        // `content_hash`. Both are passed through; the skip logic accepts
        // either. Absent on folders/malformed entries → uploads are never
        // skipped on those paths.
        hash: entry.hash,
        content_hash: entry.content_hash,
        size: entry.size,
        modifiedAt: entry.client_modified || entry.server_modified,
      }])
  )
}

/**
 * Express router for Dropbox-related API endpoints.
 */
export { normalizeDropboxPath }
export default {
  /**
   * Registers Dropbox routes on the provided webRouter.
   */
  apply(webRouter) {
    const { DROPBOX_APP_KEY: appKey, DROPBOX_APP_SECRET: appSecret } = process.env
    const oauthRedirectPath = '/user/dropbox/oauth/callback'

    webRouter.get(
      '/user/dropbox/oauth2',
      AuthenticationController.requireLogin(),
      (req, res) => {
        if (!appKey || !appSecret) {
          return res.status(503).send('Dropbox OAuth is not configured')
        }
        const state = randomBytes(24).toString('hex')
        req.session.dropboxOAuthState = state
        const siteUrl = process.env.LINKED_URL || process.env.SITE_URL || `${req.protocol}://${req.get('host')}`
        const redirectUri = new URL(oauthRedirectPath, siteUrl).toString()
        const authorizeUrl = new URL('https://www.dropbox.com/oauth2/authorize')
        authorizeUrl.search = new URLSearchParams({
          client_id: appKey,
          response_type: 'code',
          redirect_uri: redirectUri,
          token_access_type: 'offline',
          state,
        }).toString()
        res.redirect(authorizeUrl.toString())
      }
    )

    webRouter.get(
      oauthRedirectPath,
      AuthenticationController.requireLogin(),
      async (req, res) => {
        const expectedState = req.session.dropboxOAuthState
        delete req.session.dropboxOAuthState
        if (!req.query.state || req.query.state !== expectedState) {
          return res.status(400).send('Invalid Dropbox OAuth state')
        }
        if (req.query.error) return res.redirect('/user/settings')
        if (!appKey || !appSecret || typeof req.query.code !== 'string') {
          return res.status(400).send('Missing Dropbox OAuth configuration or code')
        }
        try {
          const siteUrl = process.env.LINKED_URL || process.env.SITE_URL || `${req.protocol}://${req.get('host')}`
          const redirectUri = new URL(oauthRedirectPath, siteUrl).toString()
          const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              code: req.query.code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }),
          })
          if (!tokenResponse.ok) {
            throw new Error(`Dropbox token exchange failed: ${tokenResponse.status}`)
          }
          const tokenData = await tokenResponse.json()
          const $set = {
            accessToken: encryptToken(tokenData.access_token),
            path: DEFAULT_DROPBOX_PATH,
          }
          // The authorize request uses token_access_type=offline specifically
          // so Dropbox issues a refresh token; without it every connection
          // would silently die after the access-token lifetime (hours).
          if (tokenData.refresh_token) {
            $set.refreshToken = encryptToken(tokenData.refresh_token)
          }
          await DropboxUserCredentials.findOneAndUpdate(
            { userId: req.user._id },
            { $set },
            { upsert: true, new: true }
          )
          res.redirect('/user/settings')
        } catch (err) {
          logger.error({ err }, 'Dropbox OAuth callback failed')
          res.status(502).send('Dropbox OAuth connection failed')
        }
      }
    )

    // Get user's Dropbox connection status
    webRouter.get(
      '/user/dropbox/status',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.json({ connected: false })
          }

          const path = normalizeDropboxPath(credentials.path)
          if (credentials.path !== path) {
            credentials.path = path
            await credentials.save()
          }

          // Include last-sync info for linked project state(s)
          const projects = await DropboxSyncProjectStates.find(
            { path, connected: true },
            {
              projectId: 1,
              lastSyncAt: 1,
              lastSyncError: 1,
              path: 1,
              projectName: 1,
              projectPath: 1,
            }
          ).lean()

          return res.json({
            connected: true,
            path,
            // U3: per-project entries with the full project-level path.
            projects: projects.map(p => ({
              projectId: p.projectId,
              path: p.path,
              projectName: p.projectName || null,
              projectPath: p.projectPath || null,
              lastSyncAt: p.lastSyncAt,
              lastSyncError: p.lastSyncError,
            })),
            lastSyncAt: projects[0]?.lastSyncAt || null,
            lastSyncError: projects[0]?.lastSyncError || null,
          })
        } catch (err) {
          logger.error({ err }, 'Failed to get Dropbox status')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Connect to Dropbox
    webRouter.post(
      '/user/dropbox/connect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          const { access_token } = req.body

          if (!access_token) {
            return res.status(400).json({ error: 'Missing access_token' })
          }

          // Validate token format (starts with sl.)
          if (!access_token.startsWith('sl.')) {
            logger.warn({}, 'Dropbox token does not start with sl. - may be invalid')
          }

          // Encrypt and store
          const encryptedToken = encryptToken(access_token)
          await DropboxUserCredentials.findOneAndUpdate(
            { userId },
            { accessToken: encryptedToken, path: DEFAULT_DROPBOX_PATH },
            { upsert: true, new: true }
          )

          res.json({ success: true })
        } catch (err) {
          logger.error({ err }, 'Failed to connect to Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Disconnect from Dropbox
    webRouter.post(
      '/user/dropbox/disconnect',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        try {
          // First unlink all projects associated with this user's Dropbox account
          const credentials = await DropboxUserCredentials.findOne({ userId })
          let pathToUnlink = '/'
          if (credentials) {
            pathToUnlink = normalizeDropboxPath(credentials.path)
            // H6: scope the delete to the ACTING user. The state docs carry
            // `ownerId` (the linking user, always set at link time); a legacy
            // doc without it is left in place (safe direction: never delete
            // another user's link just because paths happen to match).
            await DropboxSyncProjectStates.deleteMany({ path: pathToUnlink, ownerId: userId })
          }
          
          // Then delete the user's credentials
          await DropboxUserCredentials.deleteOne({ userId })
          res.json({ success: true, unlinkedProjects: pathToUnlink })
        } catch (err) {
          logger.error({ err }, 'Failed to disconnect from Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Get project’s Dropbox sync state
    webRouter.get(
      '/project/:project_id/dropbox/state',
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

        try {
          const state = await DropboxSyncProjectStates.findOne({ projectId })
          if (state) {
            // DBX-14: normalize in memory only (no write-on-read). Respond
            // with a PLAIN object: res.json on a mongoose document serializes
            // via toObject(), which drops non-schema properties — that is why
            // previously computed `fullPath` never reached the modal and it
            // kept falling back to the stored projectPath ("/A5 test").
            const stateObj = state.toObject()
            stateObj.path = normalizeDropboxPath(state.path)
            let fullPath = null
            try {
              const owner = state.ownerId || userId
              let project = null
              try {
                project = await ProjectGetter.promises.getProject(projectId, { name: true })
              } catch {
                project = null // display-only — fall back to state.path
              }
              const projName = project?.name
              const activeDoc = await DropboxUserCredentials.findOne(
                { userId: owner },
                { path: 1 }
              ).lean().catch(() => null)
              let legacyDoc = null
              try {
                legacyDoc = await DropboxUserCredentials.collection.db
                  .collection('dropboxusercredentials')
                  .findOne({ userId: owner }, { projection: { _id: 0, path: 1 } })
              } catch {
                legacyDoc = null
              }
              // The app sandbox folder ("Apps/<app name>") is not exposed by
              // the Dropbox API, so the fork's app-folder name is the display
              // fallback when neither credentials doc carries a real path.
              const rootPath = resolveDisplayRoot(
                activeDoc?.path && activeDoc.path !== '/' ? activeDoc.path : null,
                legacyDoc?.path
              )
              if (projName) {
                const displayTarget =
                  stateObj.path && stateObj.path !== '/'
                    ? stateObj.path
                    : joinDropboxPath(stateObj.path, projName)
                stateObj.projectPath = joinDropboxPath(stateObj.path, projName)
                fullPath = joinDisplayPath(rootPath, displayTarget)
              }
            } catch {
              // display-only enrichment — respond with the stored state below
            }
            stateObj.fullPath = fullPath
            res.json(stateObj)
          } else {
            res.json({ connected: false })
          }
        } catch (err) {
          logger.error(
            { err, projectId },
            'Failed to get project Dropbox state'
          )
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Link project to Dropbox
    webRouter.post(
      '/project/:project_id/dropbox/link',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id
        try {
          // Verify user is connected to Dropbox first
          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.status(409).json({
              error: 'Not connected to Dropbox. Please connect your account first.',
            })
          }

          // Decrypt token
          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          // Create client and verify connection
          const client = new DropboxClient({
            accessToken,
            onTokenExpired: old => getFreshDropboxAccessToken(userId, old),
          })
          await client.checkConnection()

          const dropboxPath = normalizeDropboxPath(credentials.path)
          if (credentials.path !== dropboxPath) {
            credentials.path = dropboxPath
            await credentials.save()
          }

          // Save project state (upsert: exactly ONE state doc per project;
          // ownerId scopes unlink/user-expire cleanup to the linking user)
          // H5: remember whether this request CREATED the doc so a failed
          // initial push can roll it back (no orphan "linked" state).
          const statePreExisted = Boolean(
            await DropboxSyncProjectStates.findOne({ projectId }).lean()
          )
          const state = await DropboxSyncProjectStates.findOneAndUpdate(
            { projectId },
            {
              $set: { connected: true, path: dropboxPath, ownerId: userId },
              $setOnInsert: { mergeStatus: 'clean' },
            },
            { upsert: true, new: true }
          )

          try {
            // Mirror export: snapshot the remote folder BEFORE the upload so
            // remote-only files can be removed afterwards (link = local
            // project becomes the Dropbox folder, same as Export).
            let remoteBeforeLink = {}
            try {
              const linkProject = await ProjectGetter.promises.getProject(projectId, { name: true })
              remoteBeforeLink = await getDropboxRemoteFiles(
                client,
                joinDropboxPath(dropboxPath, linkProject.name)
              )
            } catch (err) {
              if (!isDropboxNotFound(err)) throw err
            }
            const syncResult = await uploadProjectToDropbox({
              client,
              projectId,
              rootPath: dropboxPath,
              // Link is a first-time full mirror by definition: no baselines
              // yet → every file uploads exactly as before (the remote
              // snapshot exists only for the mirror-delete afterwards).
              baselines: {},
            })
            const toDeleteOnLink = remoteOnlyPaths(
              Object.keys(remoteBeforeLink),
              syncResult.localPaths,
              isSyncExcluded
            )
            for (const p of toDeleteOnLink) {
              try {
                await client.delete(joinDropboxPath(syncResult.projectPath, p))
              } catch (err) {
                if (!isDropboxNotFound(err)) {
                  logger.warn({ err, projectId, filePath: p }, 'failed to delete remote-only file during link')
                }
              }
            }
            const remoteFiles = await getDropboxRemoteFiles(client, syncResult.projectPath)
            // C1: persist the sha256 of each file as pushed (canonical
            // single-slash keys, same style as getDropboxRemoteFiles keys).
            for (const [hashPath, hashValue] of Object.entries(syncResult.localHashes || {})) {
              const k = `/` + normKey(hashPath)
              if (remoteFiles[k]) {
                remoteFiles[k] = { ...remoteFiles[k], localHash: hashValue }
              }
            }
            state.lastSyncAt = new Date()
            state.lastSyncError = undefined
            state.remoteFiles = toRemoteFilesArray(remoteFiles)
            // U3: store the full project-level path for display without a
            // project fetch on every state read.
            state.projectName = syncResult.projectName
            state.projectPath = syncResult.projectPath
            await state.save()

            res.json({ success: true, path: state.path, ...syncResult })
          } catch (linkErr) {
            // H5/RF.6: ANY failure in the post-upsert window (failed push, failed
            // re-listing, failed state save) must not leave behind a
            // "linked" state doc created by THIS request (and only this request).
            if (!statePreExisted) {
              await DropboxSyncProjectStates.deleteOne({ projectId, ownerId: userId })
            }
            throw linkErr
          }
        } catch (err) {
          logger.error(
            { err, projectId },
            'Failed to link project to Dropbox'
          )
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Unlink project from Dropbox
    webRouter.delete(
      '/project/:project_id/dropbox/state',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

        try {
          await DropboxSyncProjectStates.deleteOne({ projectId })
          res.json({ success: true })
        } catch (err) {
          logger.error(
            { err, projectId },
            'Failed to unlink project from Dropbox'
          )
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Pull remote changes into Overleaf
    webRouter.post(
      '/project/:project_id/dropbox/pull',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

        try {
          return await withProjectSyncLock(projectId, async () => {
          // Get project state and user credentials
          const state = await DropboxSyncProjectStates.findOne({
            projectId,
          }).select('path connected remoteFiles')
          if (!state || !state.connected) {
            return res.status(409).json({
              error: 'Project not linked to Dropbox',
            })
          }

          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.status(409).json({ error: 'Dropbox credentials not found' })
          }

          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          const client = new DropboxClient({
            accessToken,
            onTokenExpired: old => getFreshDropboxAccessToken(userId, old),
          })
          const dropboxPath = normalizeDropboxPath(state.path)
          // DBX-14: don't write on read — just use the normalized local copy
          // (state docs are normalized at creation time)
          state.path = dropboxPath
          let importResult
          try {
            importResult = await importProjectFromDropbox({
              client,
              projectId,
              userId,
              rootPath: dropboxPath,
              legacyRootPath: LEGACY_DROPBOX_PATH,
              previousRemoteFiles: Object.fromEntries(
                (state.remoteFiles || []).map(file => [file.path, file])
              ),
            })
          } catch (err) {
            if (!isDropboxNotFound(err)) throw err
            // ARC-06: a missing remote folder is NOT confirmation that the
            // Overleaf project should be deleted (it may be a wrong path,
            // a revoked token or an incomplete listing). Report, and let the
            // user decide. No local content is touched.
            await state.updateOne({
              lastSyncAt: new Date(),
              lastSyncError: 'Remote project folder not found (import aborted; project NOT modified)',
            })
            return res.json({
              success: false,
              message: 'Remote project folder not found. The project was NOT modified; check the Dropbox path or re-link.',
              remoteMissing: true,
            })
          }

          // ARC-06 (flag path): the helper reports a missing folder WITHOUT
          // throwing when both roots 404. Abort BEFORE any state update — an
          // empty remote listing must never be read as "remote is empty".
          if (importResult.remoteFolderMissing) {
            await state.updateOne({
              lastSyncAt: new Date(),
              lastSyncError: 'Remote project folder not found (import aborted; project NOT modified)',
            })
            return res.json({
              success: false,
              message: 'Remote project folder not found. The project was NOT modified; check the Dropbox path or re-link.',
              remoteMissing: true,
            })
          }

          // Mirror import (remote folder wins): applied the remote set and
          // deleted local-only entries (skipped when the remote folder was
          // missing — see above). A clean mirror run owns the conflict-free
          // state going forward (legacy conflict entries from old syncs are
          // cleared).
          await state.updateOne({
            remoteFiles: toRemoteFilesArray(importResult.remoteFiles),
            lastSyncAt: new Date(),
            mergeStatus: 'clean',
            lastConflict: null,
            lastSyncError: null,
            conflicts: [],
          })

          res.json({
            success: true,
            message: 'Import completed (Dropbox folder is now mirrored into the project)',
            skippedUnchanged: importResult.skippedUnchanged || 0,
            ...importResult,
          })
          })
        } catch (err) {
          await DropboxSyncProjectStates.updateOne(
            { projectId },
            { $set: { lastSyncError: err.message } }
          )
          logger.error({ err, projectId }, 'Failed to pull from Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // Push local changes to Dropbox
    webRouter.post(
      '/project/:project_id/dropbox/push',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

        try {
          return await withProjectSyncLock(projectId, async () => {
          const state = await DropboxSyncProjectStates.findOne({
            projectId,
          }).select('path connected remoteFiles')
          if (!state || !state.connected) {
            return res.status(409).json({
              error: 'Project not linked to Dropbox',
            })
          }

          const credentials = await DropboxUserCredentials.findOne({ userId })
          if (!credentials) {
            return res.status(409).json({ error: 'Dropbox credentials not found' })
          }

          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          const client = new DropboxClient({
            accessToken,
            onTokenExpired: old => getFreshDropboxAccessToken(userId, old),
          })
          const dropboxPath = normalizeDropboxPath(state.path)
          // DBX-14: don't write on read — just use the normalized local copy
          // (state docs are normalized at creation time)
          state.path = dropboxPath
          // Snapshot the remote folder BEFORE pushing. Mirror semantics:
          // after a successful export the remote folder must contain exactly
          // the local (non-excluded) file set, so this listing drives the
          // remote-only deletion. The snapshot MUST be taken against the
          // PROJECT folder (<root>/<project name>) so keys are project-
          // relative (a root listing would shift every key by the project
          // name and defeat the set comparison).
          const project = await ProjectGetter.promises.getProject(projectId, { name: true })
          if (!project) throw new Error('Project not found')
          const prePushProjectPath = joinDropboxPath(dropboxPath, project.name)
          let remoteBeforePush = {}
          try {
            remoteBeforePush = await getDropboxRemoteFiles(client, prePushProjectPath)
          } catch (err) {
            // Remote folder missing (deleted since last sync, or never
            // created yet): snapshot as empty — nothing is deleted, and the
            // uploads below recreate the folder. A hard listing failure
            // aborts the push (no partial mirror state).
            if (!isDropboxNotFound(err)) throw err
            logger.warn(
              { projectId, projectPath: prePushProjectPath },
              'push: pre-push remote project folder not found; snapshotting as empty'
            )
          }
          const remoteRelBeforePush = normalizeDropboxPathMap(remoteBeforePush)

          // Baselines for the incremental skip: per-file {rev, localHash}
          // recorded at the LAST sync (state doc). A file is skipped when the
          // remote rev is unchanged AND the local content is unchanged since
          // then; anything else uploads (local wins).
          const baselines = Object.fromEntries(
            (state.remoteFiles || []).map(f => [f.path, {
              rev: f.rev || null,
              localHash: f.localHash || null,
            }])
          )

          const syncResult = await uploadProjectToDropbox({
            client,
            projectId,
            rootPath: dropboxPath,
            // Incremental push: the pre-push snapshot carries each remote
            // file's CURRENT rev; the baselines carry the rev + local content
            // hash at last sync. Files matching both are uploaded-skip.
            remoteFiles: remoteRelBeforePush,
            baselines,
          })

          // Mirror deletion (local project wins): remove remote files that are
          // not part of the local set. Excluded remote entries are never
          // touched; the project folder itself never is (file listing only).
          const toDeleteRemote = remoteOnlyPaths(
            Object.keys(remoteRelBeforePush),
            syncResult.localPaths,
            isSyncExcluded
          )
          let deletedFromRemote = 0
          for (const rel of toDeleteRemote) {
            const remotePath = joinDropboxPath(syncResult.projectPath, rel)
            try {
              await client.delete(remotePath)
              deletedFromRemote += 1
              logger.debug({ projectId, filePath: rel }, 'deleted remote-only file during push')
            } catch (err) {
              if (!isDropboxNotFound(err)) {
                logger.warn({ err, projectId, filePath: rel }, 'failed to delete remote-only file during push')
              }
            }
          }

          // Final remote snapshot for the state baseline (revs after sync).
          let remoteFiles = remoteRelBeforePush
          try {
            remoteFiles = await getDropboxRemoteFiles(client, syncResult.projectPath)
          } catch {
            // Uploads/deletions already succeeded; keep the pre-push
            // snapshot (drift is cosmetic — the next sync re-lists).
          }
          // C1: persist the sha256 of the content as pushed — the baseline
          // for the pull-side "both sides unchanged" skip. localHashes keys
          // are canonical single-slash form; remoteFiles keys (from
          // getDropboxRemoteFiles) are too.
          for (const [hashPath, hashValue] of Object.entries(syncResult.localHashes || {})) {
            const k = `/` + normKey(hashPath)
            if (remoteFiles[k]) {
              remoteFiles[k] = { ...remoteFiles[k], localHash: hashValue }
            }
          }

          // A clean mirror run owns the conflict-free state going forward
          // (legacy conflict entries from old syncs are cleared).
          await state.updateOne({
            remoteFiles: toRemoteFilesArray(remoteFiles),
            lastSyncAt: new Date(),
            mergeStatus: 'clean',
            lastConflict: null,
            lastSyncError: null,
            conflicts: [],
          })

          res.json({
            success: true,
            uploadedFiles: syncResult.uploadedFiles,
            skippedFiles: syncResult.skippedFiles || 0,
            deletedFiles: deletedFromRemote,
            message: 'Export completed (project content is now mirrored to the Dropbox folder)',
          })
          })
        } catch (err) {
          await DropboxSyncProjectStates.updateOne(
            { projectId },
            { $set: { lastSyncError: err.message } }
          )
          logger.error({ err, projectId }, 'Failed to push to Dropbox')
          res.status(500).json({ error: err.message })
        }
      }
    )

    // List files in project's Dropbox folder
    webRouter.get(
      '/project/:project_id/dropbox/files',
      ensureUserCanWriteProjectContent,
      async (req, res) => {
        const userId = req.user?._id || req.user?.id
        if (!userId) return res.status(401).json({ error: 'Unauthorized' })

        const projectId = req.params.project_id

        try {
          const state = await DropboxSyncProjectStates.findOne({
            projectId,
          }).select('path connected')

          if (!state || !state.connected) {
            return res.status(409).json({
              error: 'Project not linked to Dropbox',
            })
          }

          // Get user credentials
          const credentials = await DropboxUserCredentials.findOne({ userId })
          let accessToken
          try {
            accessToken = decryptToken(credentials.accessToken)
          } catch (err) {
            logger.error({ err, userId }, 'Failed to decrypt Dropbox token')
            return res.status(500).json({ error: 'Token decryption failed' })
          }

          // List files using Dropbox client
          const client = new DropboxClient({
            accessToken,
            onTokenExpired: old => getFreshDropboxAccessToken(userId, old),
          })
          const dropboxPath = normalizeDropboxPath(state.path)
          // DBX-14: don't write on read — just use the normalized local copy
          // (state docs are normalized at creation time)
          state.path = dropboxPath
          const result = await client.list(dropboxPath)

          res.json({
            path: dropboxPath,
            entries: (result.entries || []).filter(
              entry => entry.type !== 'file' || !isSyncExcluded(
                relativeDropboxPath(dropboxPath, entry)
              )
            ),
          })
        } catch (err) {
          logger.error({ err, projectId }, 'Failed to list Dropbox files')
          res.status(500).json({ error: err.message })
        }
      }
    )

    webRouter.post('/project/new/dropbox', async (req, res) => {
      const userId = req.user?._id || req.user?.id
      if (!userId) return res.status(401).json({ error: 'Unauthorized' })
      const { projectName, rootPath } = req.body
      if (!projectName) {
        return res.status(400).json({ error: 'projectName is required' })
      }
      try {
        const credentials = await DropboxUserCredentials.findOne({ userId })
        if (!credentials) {
          return res.status(409).json({ error: 'Dropbox credentials not found' })
        }
        const client = new DropboxClient({
          accessToken: decryptToken(credentials.accessToken),
          onTokenExpired: old => getFreshDropboxAccessToken(userId, old),
        })
        const result = await importNewProjectFromDropbox({
          client,
          userId,
          projectName,
          rootPath: normalizeDropboxPath(rootPath ?? credentials.path),
        })
        res.json({ success: true, message: 'Import completed', ...result })
      } catch (err) {
        logger.error({ err, userId, projectName }, 'Dropbox new project import failed')
        res.status(500).json({ error: err.message || 'Import failed' })
      }
    })
  },
}
