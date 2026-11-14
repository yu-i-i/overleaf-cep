import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'

const projectId = 'a'.repeat(24)
const folderId = 'b'.repeat(24)
const sourceId = 'c'.repeat(24)
const userId = 'e'.repeat(24)
let folder
let sourceDoc
let writes

// DB・リアルタイム通知だけを差し替え、入力検証は本体の実装を使用します。
const mocks = {
  logger: { warn() {} },
  SessionManager: { getLoggedInUserId: () => userId },
  ProjectGetter: {
    promises: { getProject: async () => ({ rootFolder: [folder] }) },
  },
  ProjectLocator: {
    promises: { findElement: async () => ({ element: sourceDoc, folder }) },
  },
  EditorController: { promises: {} },
  AuthenticationController: { requireLogin: () => 'login' },
  AuthorizationMiddleware: {
    blockRestrictedUserFromProject: 'restricted',
    ensureUserCanReadProject: 'read',
    ensureUserCanWriteProjectContent: 'write',
  },
  RateLimiterMiddleware: { rateLimit: () => 'limit' },
}
globalThis.__translationMocks = mocks
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/local-llm-translation/app/src/')) {
      const key =
        specifier === '@overleaf/logger'
          ? 'logger'
          : specifier.split('/').pop()?.replace('.mjs', '')
      if (key in mocks || key === 'RateLimiter') {
        return { url: `translation-mock:${key}`, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('translation-mock:')) {
      const key = url.slice('translation-mock:'.length)
      const source =
        key === 'RateLimiter'
          ? 'export class RateLimiter {}'
          : `export default globalThis.__translationMocks[${JSON.stringify(key)}]`
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
const { default: controller } =
  await import('../app/src/LocalLlmTranslationController.mjs')
const { default: router } =
  await import('../app/src/LocalLlmTranslationRouter.mjs')

function response() {
  const res = new EventEmitter()
  Object.assign(res, {
    statusCode: 200,
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    pieces: [],
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
    sendStatus(code) {
      this.statusCode = code
      return this
    },
    set(headers) {
      this.headers = headers
      return this
    },
    flushHeaders() {
      this.headersSent = true
    },
    write(chunk) {
      this.pieces.push(chunk.toString())
      return true
    },
    end() {
      this.writableEnded = true
      return this
    },
  })
  return res
}

async function invoke(handler, body = {}) {
  const req = { params: { Project_id: projectId }, body, session: {} }
  const res = response()
  await handler(req, res, (error) => {
    res.error = error
  })
  return res
}

function saveBody(extra = {}) {
  return {
    source_doc_id: sourceId,
    parent_folder_id: folderId,
    name: 'main.en.tex',
    content: 'English\nsecond line',
    overwrite: false,
    ...extra,
  }
}

beforeEach(() => {
  writes = []
  sourceDoc = { _id: sourceId, name: 'main.tex' }
  folder = { _id: folderId, docs: [sourceDoc], fileRefs: [], folders: [] }
  for (const method of ['addDoc', 'upsertDoc']) {
    mocks.EditorController.promises[method] = async (...args) => {
      writes.push({ method, args })
      return { _id: 'd'.repeat(24), name: args[2] }
    }
  }
})

test('英語版を通常の addDoc 経路で保存し、原文は変更しない', async () => {
  const res = await invoke(controller.saveEnglishDocument, saveBody())
  assert.equal(res.error, undefined)
  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.name, 'main.en.tex')
  assert.deepEqual(writes, [
    {
      method: 'addDoc',
      args: [
        projectId,
        folderId,
        'main.en.tex',
        ['English', 'second line'],
        'local-llm-translation',
        userId,
      ],
    },
  ])
  assert.equal(sourceDoc.name, 'main.tex')
})

test('上書き確認なしの衝突・ファイル移動・誤った保存名を拒否する', async () => {
  for (const extra of [
    { name: 'other.tex' },
    { parent_folder_id: 'f'.repeat(24) },
  ]) {
    assert.equal(
      (await invoke(controller.saveEnglishDocument, saveBody(extra)))
        .statusCode,
      409
    )
  }
  folder.docs.push({ _id: 'd'.repeat(24), name: 'main.en.tex' })
  assert.equal(
    (await invoke(controller.saveEnglishDocument, saveBody())).statusCode,
    409
  )
  assert.equal(writes.length, 0)
  assert.equal(
    (
      await invoke(
        controller.saveEnglishDocument,
        saveBody({ overwrite: true })
      )
    ).statusCode,
    200
  )
  assert.equal(writes[0].method, 'upsertDoc')
})

test('通常ファイル・フォルダーとの衝突を拒否する', async () => {
  for (const field of ['fileRefs', 'folders']) {
    folder[field].push({ _id: 'd'.repeat(24), name: 'main.en.tex' })
    assert.equal(
      (await invoke(controller.saveEnglishDocument, saveBody())).statusCode,
      409
    )
    folder[field] = []
  }
  assert.equal(writes.length, 0)
})

test('不正入力はログだけで通さず、保存処理の前に拒否する', async () => {
  for (const extra of [
    { source_doc_id: 'invalid' },
    { overwrite: 'yes' },
    { unexpected: true },
  ]) {
    const res = await invoke(controller.saveEnglishDocument, saveBody(extra))
    assert.ok(res.error)
  }
  assert.equal(writes.length, 0)
})

test('英語版文書や非 TeX 文書を翻訳元として保存しない', async () => {
  for (const name of ['main.en.tex', 'references.bib']) {
    sourceDoc.name = name
    assert.equal(
      (await invoke(controller.saveEnglishDocument, saveBody())).statusCode,
      400
    )
  }
  assert.equal(writes.length, 0)
})

test('読み取りと書き込みの権限チェックをルートに登録する', () => {
  const routes = []
  const webRouter = Object.fromEntries(
    ['get', 'post', 'put'].map((method) => [
      method,
      (...args) => routes.push({ method, args }),
    ])
  )
  router.apply(webRouter)
  assert.equal(routes.length, 5)
  for (const { method, args } of routes) {
    assert.equal(args[1], 'login')
    if (args[0].startsWith('/project/')) {
      assert.equal(args[2], 'restricted')
      assert.equal(args[3], method === 'get' ? 'read' : 'write')
    }
  }
})

test('翻訳サービスの SSE を蓄積せず転送する', async () => {
  const original = globalThis.fetch
  let signal
  globalThis.fetch = async (_url, options) => {
    signal = options.signal
    return new Response('data: {"type":"complete","text":"English"}\n\n')
  }
  try {
    const res = await invoke(controller.translate, {
      text: '日本語',
      model: 'test',
    })
    assert.equal(res.error, undefined)
    assert.equal(res.headers['X-Accel-Buffering'], 'no')
    assert.equal(
      res.pieces.join(''),
      'data: {"type":"complete","text":"English"}\n\n'
    )
    assert.equal(res.writableEnded, true)
    assert.equal(signal.aborted, true)
  } finally {
    globalThis.fetch = original
  }
})

test('ブラウザー切断時は翻訳サービスへの接続を中断する', async () => {
  const original = globalThis.fetch
  let signal
  let closed = false
  const res = response()
  res.write = () => {
    res.destroyed = true
    res.emit('close')
    return true
  }
  globalThis.fetch = async (_url, options) => {
    signal = options.signal
    return {
      ok: true,
      body: (async function* () {
        try {
          yield Buffer.from('first')
          yield Buffer.from('second')
        } finally {
          closed = true
        }
      })(),
    }
  }
  try {
    await controller.translate(
      {
        params: { Project_id: projectId },
        body: { text: '日本語' },
        session: {},
      },
      res,
      (error) => {
        throw error
      }
    )
    assert.equal(signal.aborted, true)
    assert.equal(closed, true)
  } finally {
    globalThis.fetch = original
  }
})
