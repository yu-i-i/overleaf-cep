import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'

let requests
let updates
let historyVersion
const projectId = 'a'.repeat(24)
const mocks = {
  '@overleaf/settings': {
    apis: {
      project_history: { url: 'http://history' },
      v1_history: {
        url: 'http://127.0.0.1:3100/api',
        urlForGitBridge: 'http://sharelatex:3100/api',
      },
    },
  },
  '@overleaf/logger': { error() {} },
  '@overleaf/promise-utils': { expressify: (fn) => fn },
  '@overleaf/fetch-utils': {
    async fetchJson(url) {
      requests.push(url)
      return url.endsWith('/version')
        ? { version: historyVersion }
        : { files: { 'figure.png': { data: { hash: 'blob-hash' } } } }
    },
  },
  JsonWebToken: { promises: { sign: async () => 'temporary-token' } },
  ProjectGetter: { promises: { getProject: async () => ({ _id: projectId }) } },
  HistoryController: {},
  UserGetter: {},
  GitBridgeHandler: {
    normalizeAndValidateFilePath: (value) => value,
    async pushUpdate(...args) {
      updates.push(args)
    },
  },
}
globalThis.__gitMocks = mocks
// DB と履歴サービスだけを差し替え、ルーターから呼ばれる入力検証は本体を使う。
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/GitBridgeController.mjs')) {
      const key = specifier.startsWith('@')
        ? specifier
        : specifier.split('/').pop().replace('.mjs', '')
      if (key in mocks) return { url: `git-mock:${key}`, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.startsWith('git-mock:')) return next(url, context)
    const key = url.slice('git-mock:'.length)
    const named =
      key === '@overleaf/promise-utils'
        ? 'expressify'
        : key === '@overleaf/fetch-utils'
          ? 'fetchJson'
          : null
    const binding = `globalThis.__gitMocks[${JSON.stringify(key)}]`
    return {
      format: 'module',
      shortCircuit: true,
      source: named
        ? `export const ${named} = ${binding}.${named}`
        : `export default ${binding}`,
    }
  },
})
const { default: controller } =
  await import('../app/src/GitBridgeController.mjs')
beforeEach(() => {
  requests = []
  updates = []
  historyVersion = 3
})
function response() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    sendStatus(code) {
      this.statusCode = code
      return this
    },
  }
}
function request(body) {
  return {
    params: { project_id: projectId, version: '3' },
    user_id: 'owner',
    body,
  }
}
function body() {
  return {
    latestVerId: 3,
    files: [{ name: 'main.tex' }],
    postbackUrl: `http://git-bridge:8000/api/${projectId}/key/postback`,
  }
}

test('添付ファイルの取得 URL はブリッジから到達可能な履歴サーバーを使う', async () => {
  const res = response()
  await controller.getSnapshot(request(), res)
  assert.equal(
    res.body.atts[0][0],
    `http://sharelatex:3100/api/projects/${projectId}/blobs/blob-hash?token=temporary-token`
  )
})

test('不正な通知先は履歴取得・ファイル更新より前に拒否する', async () => {
  const res = response()
  await controller.postSnapshot(
    request({ ...body(), postbackUrl: 'http://mongo:27017/' }),
    res
  )
  assert.equal(res.statusCode, 400)
  assert.deepEqual(requests, [])
  assert.deepEqual(updates, [])
})

test('古いバージョンへの push は変更せずに競合を返す', async () => {
  const res = response()
  await controller.postSnapshot(request({ ...body(), latestVerId: 2 }), res)
  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.body, { code: 'outOfDate' })
  assert.deepEqual(updates, [])
})

test('正常な push は受理し、通知先と利用者を更新処理に渡す', async () => {
  const res = response()
  const input = body()
  await controller.postSnapshot(request(input), res)
  assert.deepEqual(res.body, { code: 'accepted' })
  assert.deepEqual(updates, [
    [projectId, input.files, input.postbackUrl, 'owner'],
  ])
})
