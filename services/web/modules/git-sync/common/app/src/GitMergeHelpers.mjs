import { normalize, join } from 'node:path/posix'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'crypto'
import pLimit from 'p-limit'
import logger from '@overleaf/logger'
import HistoryManager from './HistoryManager.mjs'
import UpdateMerger from '../../../../../app/src/Features/ThirdPartyDataStore/UpdateMerger.mjs'
import { GitSyncInterruptedError } from './GitSyncErrors.mjs'

// The providers share local snapshot operations, but retain separate Git commit
// and branch workflows in their respective GitMerge.mjs implementations.
export async function applyGitSnapshotToProject({ api, provider, token, userId, projectId, repoFullName, lastSyncCommit, expectedVersion, SyncStateManager }) {

  const invalidFiles = []
  const updates = []
  const deletions = []

  const historySnapshot = await HistoryManager.getProjectSnapshot(projectId, expectedVersion)
  const blobMap = await getGitBlobMap(api, token, repoFullName, lastSyncCommit)
  const blobPaths = new Set()
  const expectedHashes = { ...blobMap }

  for (const [path, sha] of Object.entries(blobMap)) {
    const invalid = validateFileName(path)

    if (invalid) {
      invalidFiles.push(invalid.name)
      continue
    }

    blobPaths.add(path)

    const hstSha = getEntryHash(historySnapshot[path])
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
  // This immutable history version already represents the Git tree. Any edits
  // since that version remain pending, even if Git took a long time to respond.
  if (!updates.length && !deletions.length) return expectedVersion

  if (await HistoryManager.latestVersion(projectId) !== expectedVersion) {
    throw new GitSyncInterruptedError()
  }

  const directory = updates.length ? await mkdtemp(join(tmpdir(), 'overleaf-git-sync-')) : null
  try {
    // Finish every network read before touching Overleaf. Use disk so a large
    // project does not have to fit in memory. Wait for all streams before cleanup.
    const limit = pLimit(api.maxConcurrency)
    const downloads = await Promise.allSettled(updates.map((path, index) => limit(async () => {
      const stream = await api.getBlobStream(token, repoFullName, lastSyncCommit, path)
      const file = join(directory, String(index))
      await pipeline(stream, createWriteStream(file))
      const { size } = await stat(file)
      const hash = createHash('sha1').update(`blob ${size}\0`)
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      if (hash.digest('hex') !== blobMap[path]) throw new GitSyncInterruptedError()
    })))
    const failed = downloads.find(result => result.status === 'rejected')
    if (failed) throw failed.reason

    const pendingPull = {
      commit: lastSyncCommit,
      cursorVersion: expectedVersion, complete: false,
    }
    // Persist intent before the first mutation. A rejected write may still have
    // reached Overleaf, so recovery also scans history after cursorVersion.
    await SyncStateManager.updateProjectState(projectId, { pendingPull })

    let checkedVersion = expectedVersion
    // UpdateMerger writes one path at a time. After each write, allow only
    // provider history before starting the next one. The check and the write
    // are separate calls, so an edit inside one write can still race with it.
    async function checkBeforeWrite() {
      const head = await HistoryManager.latestVersion(projectId)
      if (head !== checkedVersion) {
        throw new GitSyncInterruptedError()
      }
    }

    async function recordProgress() {
      const head = await HistoryManager.latestVersion(projectId)
      checkedVersion = await providerPrefixEnd(projectId, checkedVersion, head, provider)
      pendingPull.cursorVersion = checkedVersion
      await SyncStateManager.updateProjectState(projectId, { pendingPull: { ...pendingPull } })
    }

    for (const [index, path] of updates.entries()) {
      await checkBeforeWrite()
      const file = join(directory, String(index))
      let result
      if (UpdateMerger.promises._mergeUpdate) {
        // The file is already staged. Avoid another disk copy between the
        // history check and the actual editor write.
        result = await UpdateMerger.promises._mergeUpdate(userId, projectId, '/' + path, file, provider)
      } else {
        const stream = createReadStream(file)
        try {
          result = await UpdateMerger.promises.mergeUpdate(userId, projectId, '/' + path, stream, provider)
        } finally {
          stream.destroy()
        }
      }
      if (result?.entityType === 'doc') {
        // Documents are stored as lines. Binary entities retain their original
        // byte hashes, including binary files with text-like contents.
        const content = await readFile(file, 'utf8')
        expectedHashes[path] = gitBlobShaFromString(content.replace(/\r\n|\r/g, '\n'))
      }
      await recordProgress()

    }
    for (const path of deletions) {
      await checkBeforeWrite()
      await UpdateMerger.promises.deleteUpdate(userId, projectId, '/' + path, provider)
      await recordProgress()
    }

    const head = await HistoryManager.latestVersion(projectId)
    const checkpoint = await providerPrefixEnd(projectId, checkedVersion, head, provider)
    const snapshot = await HistoryManager.getProjectSnapshot(projectId, checkpoint)
    if (Object.keys(snapshot).length !== blobPaths.size ||
        [...blobPaths].some(path => getEntryHash(snapshot[path]) !== expectedHashes[path])) {
      throw new GitSyncInterruptedError()
    }
    await SyncStateManager.updateProjectState(projectId, { pendingPull: { ...pendingPull, cursorVersion: checkpoint, complete: true } })
    return checkpoint
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}

// History summaries are newest first. Only a contiguous provider-only prefix
// is a safe import baseline. A later provider write can have overwritten an edit.
export async function inspectPullHistory(projectId, start, end, provider) {
  if (end === start) return { version: start, concurrent: false, interleaved: false }
  if (!Number.isSafeInteger(end) || end < start) throw new GitSyncInterruptedError()
  const updates = await HistoryManager.getUpdatesSince(projectId, start)
  let cursor = start
  let version = start
  let concurrent = false
  let interleaved = false
  for (const update of [...updates].reverse()) {
    const { fromV, toV } = update
    if (!Number.isSafeInteger(fromV) || !Number.isSafeInteger(toV) || fromV >= toV) {
      throw new GitSyncInterruptedError()
    }
    if (toV <= start || fromV >= end) continue
    if (Math.max(start, fromV) !== cursor) throw new GitSyncInterruptedError()
    const next = Math.min(end, toV)
    if (update.meta?.origin?.kind === provider) {
      if (concurrent) interleaved = true
      else version = next
    } else {
      concurrent = true
    }
    cursor = next
  }
  if (cursor !== end) throw new GitSyncInterruptedError()
  return { version, concurrent, interleaved }
}

async function providerPrefixEnd(projectId, start, end, provider) {
  const progress = await inspectPullHistory(projectId, start, end, provider)
  if (progress.interleaved) throw new GitSyncInterruptedError()
  return progress.version
}

export async function getGitBlobMap(api, token, repoFullName, commit) {
  const blobEntries = await api.listBlobsAtCommit(token, repoFullName, commit)
  return Object.fromEntries(
    blobEntries.map(({ path, sha }) => [path, sha])
  )
}

export function generateBranchName() {
  const d = new Date()
  const pad = n => `${n}`.padStart(2, '0')
  return `overleaf-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function getEntryHash(entry) {
  if (!entry?.data) return null
  return (
    entry.data.hash ||
    gitBlobShaFromString(entry.data.content)
  )
}

// Hash-only (binary) entries require exact bytes. For inline documents try the
// usual uniform endings first, then inspect mixed endings within a bounded size.
export async function matchesDocumentBlob(entry, sha, openStream) {
  const content = entry?.data?.content
  if (typeof content !== 'string') return false
  if (gitBlobShaFromString(content) === sha) return true
  if (!content.includes('\n')) return false
  for (const ending of ['\r\n', '\r']) {
    if (gitBlobShaFromString(content.replaceAll('\n', ending)) === sha) return true
  }
  if (content.indexOf('\n') === content.lastIndexOf('\n')) return false
  const limit = Buffer.byteLength(content) + content.split('\n').length - 1
  const chunks = []
  let size = 0
  for await (const chunk of await openStream()) {
    size += chunk.length
    if (size > limit) return false
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  if (createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex') !== sha) {
    throw new Error('Downloaded document does not match its Git blob')
  }
  const text = bytes.toString('utf8')
  return Buffer.from(text).equals(bytes) && text.replace(/\r\n|\r/g, '\n') === content
}

function gitBlobShaFromString(str) {
  if (str == null) return null
  const content = Buffer.from(str, 'utf8')
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
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

export function getChangedPaths(diff, paths) {
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
    deletePaths.delete(path)
  }

  return { deletePaths, upsertPaths }
}

