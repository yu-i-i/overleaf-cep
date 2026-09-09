import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

// Hermetic mocks: the import lane only touches the collaborators listed here.
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
  default: {
    promises: {
      upsertDocWithPath: vi.fn(),
      upsertFileWithPath: vi.fn(),
    },
  },
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
vi.mock('@overleaf/settings', () => ({
  default: { textExtensions: ['tex', 'bib', 'md'] },
}))

const { importProjectFromDropbox } = await import('../../../app/src/DropboxRouter.mjs')

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
  default: EditorController,
} = await import(
  '../../../../../app/src/Features/Editor/EditorController.mjs'
)

const sha256 = data => createHash('sha256').update(data).digest('hex')

const LOCAL_TEX = 'shared-content-v1'
const LOCAL_TEX_HASH = sha256(LOCAL_TEX)

function makeFakeClient() {
  return {
    list: vi.fn(async () => ({ entries: [] })),
    download: vi.fn(async p => ({
      relative_path: p,
      content_base64: Buffer.from(LOCAL_TEX).toString('base64'),
    })),
    upload: vi.fn(async () => ({})),
    createDirectory: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  }
}

describe('importProjectFromDropbox (rev+baseline change detection)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ProjectGetter.promises.getProject.mockResolvedValue({ _id: 'p1', name: 'imp' })
  })

  it('applies a document when its remote rev changed (remote wins; Dropbox hash fields are NOT compared)', async () => {
    // Rev DID change (no stored baseline) → apply, even though the entry
    // carries a content_hash equal to the local sha256. Dropbox's hash
    // fields (hash/content_hash) are plain metadata here, NOT a decision
    // input: the live API's content_hash is not a plain SHA-256, and even
    // when it matched, apply (remote wins) is the safe direction.
    const client = makeFakeClient()
    client.list.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'main.tex',
          relative_path: '/Apps/imp/main.tex',
          path_display: '/Apps/imp/main.tex',
          rev: 'rev1',
          size: LOCAL_TEX.length,
          content_hash: LOCAL_TEX_HASH,
        },
      ],
    })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/main.tex': { lines: LOCAL_TEX.split('\n') },
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})

    const result = await importProjectFromDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps',
      legacyRootPath: null,
      previousRemoteFiles: {},
      userId: 'u1',
    })

    expect(client.download).toHaveBeenCalledTimes(1)
    expect(EditorController.promises.upsertDocWithPath).toHaveBeenCalledTimes(1)
    expect(result.importedFiles).toBe(1)
    expect(result.skippedUnchanged).toBe(0)
  })

  it('downloads and applies a document whose local content differs (remote wins)', async () => {
    const client = makeFakeClient()
    client.list.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'main.tex',
          relative_path: '/Apps/imp/main.tex',
          path_display: '/Apps/imp/main.tex',
          rev: 'rev2',
          size: 99,
          hash: sha256('remote-new-content'),
        },
      ],
    })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/main.tex': { lines: ['stale-local'] },
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})

    const result = await importProjectFromDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps',
      legacyRootPath: null,
      previousRemoteFiles: {},
      userId: 'u1',
    })

    expect(client.download).toHaveBeenCalledTimes(1)
    expect(EditorController.promises.upsertDocWithPath).toHaveBeenCalledTimes(1)
    expect(result.importedFiles).toBe(1)
    expect(result.skippedUnchanged).toBe(0)
  })

  it('re-applies when the local file is gone (remote wins, locally deleted)', async () => {
    const client = makeFakeClient()
    client.list.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'main.tex',
          relative_path: '/Apps/imp/main.tex',
          path_display: '/Apps/imp/main.tex',
          rev: 'rev3',
          size: 5,
          hash: LOCAL_TEX_HASH,
        },
      ],
    })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({})
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})

    const result = await importProjectFromDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps',
      legacyRootPath: null,
      previousRemoteFiles: {},
      userId: 'u1',
    })

    expect(client.download).toHaveBeenCalledTimes(1)
    expect(result.importedFiles).toBe(1)
  })

  it('applies blob files without a stored baseline (first import)', async () => {
    const client = makeFakeClient()
    client.list.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'pic.png',
          relative_path: '/Apps/imp/pic.png',
          path_display: '/Apps/imp/pic.png',
          rev: 'rev9',
          size: 12,
          hash: LOCAL_TEX_HASH, // present in metadata, but never a decision input
        },
      ],
    })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({})
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({
      '/pic.png': { hash: 'blobstore-id' },
    })
    EditorController.promises.upsertFileWithPath.mockResolvedValue(true)

    const result = await importProjectFromDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps',
      legacyRootPath: null,
      previousRemoteFiles: {},
      userId: 'u1',
    })

    expect(client.download).toHaveBeenCalledTimes(1)
    expect(EditorController.promises.upsertFileWithPath).toHaveBeenCalledTimes(1)
    expect(result.importedFiles).toBe(1)
  })

  it('skips unchanged (baseline rev + hash match) AND applies changed in one pass', async () => {
    const client = makeFakeClient()
    client.list.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'a.tex',
          relative_path: '/Apps/imp/a.tex',
          path_display: '/Apps/imp/a.tex',
          rev: 'rA1', // same rev as stored baseline
          size: 4,
        },
        {
          type: 'file',
          name: 'b.tex',
          relative_path: '/Apps/imp/b.tex',
          path_display: '/Apps/imp/b.tex',
          rev: 'rB1', // no baseline → apply
          size: 4,
        },
      ],
    })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/a.tex': { lines: ['same'] }, // local hash == stored localHash
      '/b.tex': { lines: ['B-local'] },
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})

    const result = await importProjectFromDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps',
      legacyRootPath: null,
      previousRemoteFiles: {
        '/a.tex': { rev: 'rA1', localHash: sha256('same') },
      },
      userId: 'u1',
    })

    expect(result.importedFiles).toBe(1) // only b.tex
    expect(result.skippedUnchanged).toBe(1) // a.tex
    expect(client.download).toHaveBeenCalledTimes(1)
    expect(client.download.mock.calls[0][0].endsWith('/b.tex')).toBe(true)
  })

  it('re-applies a baseline file when the local content diverged (remote wins)', async () => {
    const client = makeFakeClient()
    client.list.mockResolvedValue({
      entries: [
        {
          type: 'file',
          name: 'a.tex',
          relative_path: '/Apps/imp/a.tex',
          path_display: '/Apps/imp/a.tex',
          rev: 'rA1', // unchanged rev…
          size: 4,
        },
      ],
    })
    ProjectEntityHandler.promises.getAllDocs.mockResolvedValue({
      '/a.tex': { lines: ['CHANGED locally'] }, // …but local content moved on
    })
    ProjectEntityHandler.promises.getAllFiles.mockResolvedValue({})

    const result = await importProjectFromDropbox({
      client,
      projectId: 'p1',
      rootPath: 'Apps',
      legacyRootPath: null,
      previousRemoteFiles: {
        '/a.tex': { rev: 'rA1', localHash: sha256('UNCHANGED baseline') },
      },
      userId: 'u1',
    })

    expect(client.download).toHaveBeenCalledTimes(1)
    expect(result.importedFiles).toBe(1)
    expect(result.skippedUnchanged).toBe(0)
  })
})
