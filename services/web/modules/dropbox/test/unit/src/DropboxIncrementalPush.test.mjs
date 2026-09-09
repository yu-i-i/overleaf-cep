import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

// DropboxRouter imports a lot of app-level machinery; stub it so
// uploadProjectToDropbox can be exercised hermetically.
vi.mock('../../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs', () => ({
  default: {
    ensureUserCanWriteProjectContent: () => (req, res, next) => next(),
  },
}))
vi.mock('../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
  default: { promises: { getProject: vi.fn() } },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
  default: {
    promises: {
      getAllDocs: vi.fn(),
      getAllFiles: vi.fn(),
    },
  },
}))
vi.mock('../../../../../app/src/Features/Editor/EditorController.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs', () => ({
  default: { promises: { flushProjectToMongo: vi.fn(async () => true) } },
}))
vi.mock('../../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/History/HistoryManager.mjs', () => ({
  default: { promises: { requestBlobWithProjectId: vi.fn() } },
}))
vi.mock('../../../app/models/dropboxUserCredentials.mjs', () => ({
  DropboxUserCredentials: {},
}))
vi.mock('../../../app/models/dropboxSyncProjectStates.mjs', () => ({
  DropboxSyncProjectStates: {},
}))
vi.mock('@overleaf/settings', () => ({ default: {} }))

const {
  shouldSkipDropboxPush,
  uploadProjectToDropbox,
} = await import('../../../app/src/DropboxRouter.mjs')

const {
  default: ProjectGetter,
} = await import(
  '../../../../../app/src/Features/Project/ProjectGetter.mjs'
)
const {
  default: ProjectEntityHandler,
} = await import(
  '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
)
const {
  default: HistoryManager,
} = await import('../../../../../app/src/Features/History/HistoryManager.mjs')

const sha256 = data => createHash('sha256').update(data).digest('hex')

function makeFakeClient() {
  return {
    upload: vi.fn(async () => ({ revision: 'rev' })),
    createDirectory: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    list: vi.fn(async () => ({ entries: [] })),
  }
}

describe('shouldSkipDropboxPush (baseline skip decision)', () => {
  const OK = {
    storedRev: 'r1',
    currentRev: 'r1',
    storedLocalHash: 'a'.repeat(64),
    currentLocalHash: 'a'.repeat(64),
  }

  it('skips when the remote rev AND the local content are unchanged since last sync', () => {
    expect(shouldSkipDropboxPush(OK)).toBe(true)
  })

  it('is case-insensitive on the content hashes', () => {
    expect(shouldSkipDropboxPush({ ...OK, currentLocalHash: 'A'.repeat(64) })).toBe(true)
  })

  it('uploads when there is no stored baseline yet (first sync)', () => {
    expect(shouldSkipDropboxPush({ ...OK, storedRev: null })).toBe(false)
    expect(shouldSkipDropboxPush({ ...OK, storedLocalHash: null })).toBe(false)
  })

  it('uploads when the remote file changed since last sync (local wins)', () => {
    expect(shouldSkipDropboxPush({ ...OK, currentRev: 'r2' })).toBe(false)
    expect(shouldSkipDropboxPush({ ...OK, currentRev: null })).toBe(false)
  })

  it('uploads when the local content changed since last sync (local wins)', () => {
    expect(shouldSkipDropboxPush({ ...OK, currentLocalHash: 'b'.repeat(64) })).toBe(false)
    expect(shouldSkipDropboxPush({ ...OK, currentLocalHash: null })).toBe(false)
  })
})

describe('uploadProjectToDropbox (incremental mirror push)', () => {
  let client

  const DOC_LINES = ['hello', 'world']
  const DOC_CONTENT = DOC_LINES.join('\n')
  const DOC_HASH = sha256(DOC_CONTENT)
  const BLOB_CONTENT = Buffer.from('PNGBLOB')
  const BLOB_HASH = sha256(BLOB_CONTENT)

  beforeEach(async () => {
    client = makeFakeClient()
    ProjectGetter.promises.getProject.mockResolvedValue({ _id: 'p1', name: 'testproj' })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/main.tex': { lines: DOC_LINES },
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({
      '/img.png': { hash: 'blob1' },
    })
    HistoryManager.promises.requestBlobWithProjectId.mockResolvedValue({
      stream: Readable.from([BLOB_CONTENT]),
    })
  })

  it('skips every upload when remote rev AND local content are unchanged (zero writes)', async () => {
    const result = await uploadProjectToDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps/Overleaf Dev',
      remoteFiles: {
        '/main.tex': { rev: 'rMain' },
        '/img.png': { rev: 'rImg' },
      },
      baselines: {
        '/main.tex': { rev: 'rMain', localHash: DOC_HASH },
        '/img.png': { rev: 'rImg', localHash: BLOB_HASH },
      },
    })

    expect(client.upload).not.toHaveBeenCalled()
    expect(result.uploadedFiles).toBe(0)
    expect(result.skippedFiles).toBe(2)
    // No redundant mkdir churn for unchanged content.
    expect(client.createDirectory).not.toHaveBeenCalled()
    // C1 baselines still recorded (unchanged content → baselines hold).
    expect(result.localHashes['/main.tex']).toBe(DOC_HASH)
    expect(result.localHashes['/img.png']).toBe(BLOB_HASH)
  })

  it('accepts slash-free baseline/current keys (state-doc + normalized-snapshot styles)', async () => {
    const result = await uploadProjectToDropbox({
      client,
      projectId: 'p1',
      rootPath: 'root',
      remoteFiles: {
        'main.tex': { rev: 'rM' },
        'img.png': { rev: 'rI' },
      },
      baselines: {
        'main.tex': { rev: 'rM', localHash: DOC_HASH },
        'img.png': { rev: 'rI', localHash: BLOB_HASH },
      },
    })

    expect(client.upload).not.toHaveBeenCalled()
    expect(result.skippedFiles).toBe(2)
  })

  it('uploads the locally-changed file and only it (local wins)', async () => {
    const result = await uploadProjectToDropbox({
      client,
      projectId: 'p1',
      rootPath: 'root',
      remoteFiles: {
        '/main.tex': { rev: 'rM' },
        '/img.png': { rev: 'rI' },
      },
      baselines: {
        // main.tex baseline does NOT match the current local content:
        '/main.tex': { rev: 'rM', localHash: sha256('stale baseline content') },
        '/img.png': { rev: 'rI', localHash: BLOB_HASH },
      },
    })

    expect(client.upload).toHaveBeenCalledTimes(1)
    expect(client.upload.mock.calls[0][0]).toBe('/root/testproj/main.tex')
    expect(result.uploadedFiles).toBe(1)
    expect(result.skippedFiles).toBe(1)
  })

  it('uploads a file whose remote rev changed since last sync (local wins)', async () => {
    const result = await uploadProjectToDropbox({
      client,
      projectId: 'p1',
      rootPath: 'root',
      remoteFiles: {
        '/main.tex': { rev: 'rM-NEW' },
        '/img.png': { rev: 'rI' },
      },
      baselines: {
        '/main.tex': { rev: 'rM-OLD', localHash: DOC_HASH },
        '/img.png': { rev: 'rI', localHash: BLOB_HASH },
      },
    })

    expect(client.upload).toHaveBeenCalledTimes(1)
    expect(client.upload.mock.calls[0][0]).toBe('/root/testproj/main.tex')
    expect(result.skippedFiles).toBe(1)
  })

  it('uploads everything when there is no baseline (first push / folder re-created)', async () => {
    const result = await uploadProjectToDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps/Overleaf Dev',
      remoteFiles: {
        '/main.tex': { rev: 'rM' },
        '/img.png': { rev: 'rI' },
      },
      baselines: {},
    })

    expect(result.uploadedFiles).toBe(2)
    expect(result.skippedFiles).toBe(0)
    // The project directory chain is created once (deduped across
    // root-level files) instead of once per file.
    const rootMkdirs = client.createDirectory.mock.calls
      .map(c => c[0])
      .filter(p => p === '/Apps/Overleaf Dev/testproj')
    expect(rootMkdirs.length).toBe(1)
  })

  it('creates subdirectory chains only for directories that receive an upload', async () => {
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/sub/note.tex': { lines: ['deep'] },
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})
    const subHash = sha256('deep')

    // Case A: unchanged nested file → no mkdir at all.
    const unchangedClient = makeFakeClient()
    await uploadProjectToDropbox({
      client: unchangedClient,
      projectId: 'p1',
      rootPath: 'root',
      remoteFiles: { '/sub/note.tex': { rev: 'rA' } },
      baselines: { '/sub/note.tex': { rev: 'rA', localHash: subHash } },
    })
    expect(unchangedClient.upload).not.toHaveBeenCalled()
    expect(unchangedClient.createDirectory).not.toHaveBeenCalled()

    // Case B: changed nested file → chain created once, then uploaded.
    const changedClient = makeFakeClient()
    await uploadProjectToDropbox({
      client: changedClient,
      projectId: 'p1',
      rootPath: 'root',
      remoteFiles: { '/sub/note.tex': { rev: 'rB' } },
      baselines: { '/sub/note.tex': { rev: 'rB', localHash: sha256('other') } },
    })
    expect(changedClient.createDirectory).toHaveBeenCalledTimes(3)
    expect(changedClient.createDirectory.mock.calls.map(c => c[0])).toEqual([
      '/root',
      '/root/testproj',
      '/root/testproj/sub',
    ])
    expect(changedClient.upload).toHaveBeenCalledTimes(1)
  })

  it('never uploads or skips sync-excluded entries (data safety)', async () => {
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/main.tex': { lines: ['keep'] },
      '/.hidden/secret.tex': { lines: ['do not push'] },
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})

    const result = await uploadProjectToDropbox({
      client,
      projectId: 'p1',
      rootPath: 'root',
      remoteFiles: { '/main.tex': { rev: 'r' } },
      baselines: {},
    })

    const uploaded = client.upload.mock.calls.map(c => c[0])
    expect(uploaded).toEqual(['/root/testproj/main.tex'])
    expect(result.localPaths).toEqual(['/main.tex'])
    expect(Object.keys(result.localHashes)).toEqual(['/main.tex'])
  })
})

describe('uploadProjectToDropbox localHashes baseline', () => {
  it('records the sha256 of every non-excluded local file, skipped or not', async () => {
    const fake = makeFakeClient()
    ProjectGetter.promises.getProject.mockResolvedValue({ _id: 'p1', name: 't' })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/a.tex': { lines: ['A'] },
      '/b.tex': { lines: ['B'] },
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})

    const result = await uploadProjectToDropbox({
      client: fake,
      projectId: 'p1',
      rootPath: 'root',
      remoteFiles: {
        '/a.tex': { rev: 'rA' },
        '/b.tex': { rev: 'rB' },
      },
      baselines: {
        '/a.tex': { rev: 'rA', localHash: sha256('A') }, // skipped
        // b.tex: no baseline → uploaded
      },
    })

    expect(result.uploadedFiles).toBe(1)
    expect(result.skippedFiles).toBe(1)
    expect(result.localHashes).toEqual({
      '/a.tex': sha256('A'),
      '/b.tex': sha256('B'),
    })
  })
})
