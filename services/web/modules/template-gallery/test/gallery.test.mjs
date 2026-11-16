import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'
import { beforeEach, test } from 'node:test'

const id = 'a'.repeat(24)
let template
let user
let databaseReads
let flushes
let fetches
let deletions
let saved
let queryError
const settings = {
  templates: { user_id: 'curator', nonAdminCanManage: false },
  templateLinks: [{ name: 'All', url: '/templates/all' }],
  apis: { filestore: { url: 'http://filestore' } },
}
class Template {
  constructor(data) {
    Object.assign(this, data, { _id: id, version: 1 })
  }
  async save() {
    saved++
  }
  static findOne() {
    databaseReads++
    return {
      exec: async () => {
        if (queryError) throw queryError
        return template
      },
    }
  }
  static find() {
    return { exec: async () => [] }
  }
  static findById() {
    databaseReads++
    return {
      select() {
        return this
      },
      async lean() {
        if (queryError) throw queryError
        return template
      },
      then(resolve, reject) {
        return Promise.resolve(template).then(resolve, reject)
      },
    }
  }
  static deleteOne() {
    return {
      exec: async () => {
        deletions++
      },
    }
  }
}
const writeAccess = () => {}
const controllers = Object.fromEntries(
  [
    'createTemplateFromProject',
    'editTemplate',
    'deleteTemplate',
    'templateDetailsPage',
    'templatesCategoryPage',
    'getTemplateJSON',
    'getCategoryTemplatesJSON',
    'getTemplatePreview',
  ].map((key) => [key, () => {}])
)
const mocks = {
  '@overleaf/settings': settings,
  '@overleaf/logger': { error() {}, warn() {}, debug() {} },
  '@overleaf/fetch-utils': {
    async fetchStreamWithResponse(url) {
      fetches.push(url)
      return { response: new Response('pdf', { status: 200 }) }
    },
  },
  request: (_options, callback) => callback(null, { statusCode: 200 }),
  Template,
  ProjectGetter: {
    promises: {
      getProject: async () => ({
        compiler: 'pdflatex',
        spellCheckLanguage: 'en',
      }),
    },
  },
  ProjectLocator: {
    promises: {
      findRootDoc: async () => ({ path: { fileSystem: '/main.tex' } }),
    },
  },
  DocumentUpdaterHandler: {
    promises: {
      flushProjectToMongo: async () => {
        flushes++
      },
    },
  },
  ProjectZipStreamManager: {
    createZipStreamForProject: (_id, _flag, _user, callback) =>
      callback(null, Readable.from('zip')),
  },
  ClsiManager: {
    promises: { getOutputFileStream: async () => Readable.from('pdf') },
  },
  UserGetter: {
    promises: {
      getUser: async () => ({ first_name: 'Other', isAdmin: false }),
    },
  },
  SessionManager: {
    getSessionUser: () => user,
    getLoggedInUserId: () => user?._id,
  },
  AdminAuthorizationHelper: {
    hasAdminAccess: (value) => Boolean(value?.isAdmin),
  },
  HttpErrorHandler: {
    forbidden: (_req, res) => {
      res.statusCode = 403
    },
  },
  ErrorController: { notFound() {} },
  AuthenticationController: { requireLogin: () => () => {} },
  AuthorizationMiddleware: { ensureUserCanWriteProjectContent: writeAccess },
  RateLimiterMiddleware: { rateLimit: () => () => {} },
  TemplateGalleryController: controllers,
}
globalThis.__galleryMocks = mocks
// DB・文書保存・ファイル転送だけを差し替える。入力検証と HTML 無害化は実装本体を使う。
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/template-gallery/app/src/')) {
      const key = specifier.startsWith('@')
        ? specifier
        : specifier.split('/').pop().replace('.mjs', '')
      if (key in mocks || key === 'RateLimiter') {
        return { url: `gallery-mock:${key}`, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.startsWith('gallery-mock:')) return next(url, context)
    const key = url.slice('gallery-mock:'.length)
    const binding = `globalThis.__galleryMocks[${JSON.stringify(key)}]`
    let source
    if (key === 'RateLimiter') source = 'export class RateLimiter {}'
    else if (key === 'Template') source = `export const Template = ${binding}`
    else if (key === '@overleaf/fetch-utils')
      source = `export const fetchStreamWithResponse = ${binding}.fetchStreamWithResponse`
    else source = `export default ${binding}`
    return { format: 'module', source, shortCircuit: true }
  },
})
const { validateTemplateInput, renderTemplateHtmlFields } =
  await import('../app/src/TemplateGalleryHelper.mjs')
const { default: manager } =
  await import('../app/src/TemplateGalleryManager.mjs')
const { default: middleware } =
  await import('../app/src/TemplateAuthorizationMiddleware.mjs')
const { default: router } = await import('../app/src/TemplateGalleryRouter.mjs')
const { default: realController } =
  await import('../app/src/TemplateGalleryController.mjs')

beforeEach(() => {
  databaseReads = 0
  flushes = 0
  fetches = []
  deletions = 0
  saved = 0
  queryError = null
  user = { _id: 'reader' }
  template = {
    _id: id,
    owner: 'owner',
    version: 2,
    name: 'Lab',
    category: '/templates/all',
    compiler: 'pdflatex',
    mainFile: 'main.tex',
    license: 'lppl_1.3c',
    async save() {
      saved++
    },
  }
})
const input = () => ({
  name: 'Lab',
  category: '/templates/all',
  license: 'lppl_1.3c',
  build: 'build-id',
})

test('公開にはタイトル・カテゴリー・ライセンスとコンパイル済みの版が必要', () => {
  validateTemplateInput(input(), { isNew: true })
  for (const field of ['name', 'category', 'license', 'build']) {
    const value = input()
    delete value[field]
    assert.throws(() => validateTemplateInput(value, { isNew: true }))
  }
  assert.throws(() =>
    validateTemplateInput({ ...input(), build: '../output' }, { isNew: true })
  )
})

test('文字列以外のメタデータと空タイトル・過大な説明を拒否する', () => {
  for (const value of [
    null,
    [],
    { name: { $ne: null } },
    { descriptionMD: [] },
    { name: ' ' },
    { descriptionMD: 'a'.repeat(4097) },
  ]) {
    assert.throws(() => validateTemplateInput(value))
  }
  validateTemplateInput({ descriptionMD: '', authorMD: '研究室' })
})

test('説明文のスクリプトや危険なリンクを表示用 HTML に残さない', () => {
  const fields = {
    descriptionMD:
      '<script>alert(1)</script>\n\n**Lab** [bad](javascript:alert(1))',
    authorMD: '[name](https://example.test)',
  }
  renderTemplateHtmlFields(fields)
  assert.match(fields.description, /<strong>Lab<\/strong>/)
  assert.doesNotMatch(fields.description, /<script|javascript:/)
  assert.match(fields.author, /https:\/\/example.test/)
})

test('override=true を指定しても他人のテンプレートを上書きできない', async () => {
  const result = await manager.createTemplateFromProject({
    projectId: id,
    userId: 'reader',
    templateSource: { ...input(), override: true },
  })
  assert.equal(result.conflict, true)
  assert.equal(result.canOverride, false)
  assert.equal(flushes, 0)
  assert.deepEqual(fetches, [])
  assert.equal(saved, 0)
})

test('所有者の再公開は新しい版のソース・PDF を保存する', async () => {
  const result = await manager.createTemplateFromProject({
    projectId: id,
    userId: 'owner',
    templateSource: { ...input(), override: true },
  })
  assert.equal(result.conflict, false)
  assert.equal(template.version, 3)
  assert.equal(saved, 1)
  assert.equal(flushes, 1)
  assert.deepEqual(fetches, [
    `http://filestore/template/${id}/v/3/zip`,
    `http://filestore/template/${id}/v/3/pdf`,
  ])
})

test('説明の編集では所有者・版番号・メインファイルを変更させない', async () => {
  await manager.editTemplate({
    templateId: id,
    updates: {
      descriptionMD: 'Updated',
      owner: 'reader',
      version: 99,
      mainFile: '../other.tex',
    },
  })
  assert.equal(template.owner, 'owner')
  assert.equal(template.version, 2)
  assert.equal(template.mainFile, 'main.tex')
  assert.equal(template.descriptionMD, 'Updated')
})

test('検索キーを名前と ID に限定し、MongoDB 演算子を受け付けない', async () => {
  for (const [key, val] of [
    ['$where', 'while(true){}'],
    ['owner', 'owner'],
    ['_id', 'invalid'],
    ['name', { $ne: null }],
  ]) {
    await assert.rejects(manager.getTemplate(key, val))
  }
  assert.equal(databaseReads, 0)
  assert.equal((await manager.getTemplate('name', 'Lab')).id, id)
})

test('プレビュー・削除でパスを操作する ID や版番号を拒否する', async () => {
  for (const version of [
    '../zip',
    '0',
    '-1',
    '1?other=true',
    '9007199254740992',
  ]) {
    await assert.rejects(
      manager.fetchTemplatePreview({ templateId: id, version })
    )
    await assert.rejects(manager.deleteTemplate({ templateId: id, version }))
  }
  await assert.rejects(
    manager.fetchTemplatePreview({ templateId: '../project', version: '1' })
  )
  assert.deepEqual(fetches, [])
  assert.equal(deletions, 0)
})

test('正常な PDF プレビューをファイルストアから転送する', async () => {
  const preview = await manager.fetchTemplatePreview({
    templateId: id,
    version: '2',
  })
  assert.equal(preview.contentType, 'application/pdf')
  assert.deepEqual(fetches, [`http://filestore/template/${id}/v/2/pdf?`])
})

test('管理者と管理担当者は管理でき、一般利用者は自分の既存テンプレートだけ編集できる', async () => {
  for (const [value, params, allowed] of [
    [{ _id: 'admin', isAdmin: true }, {}, true],
    [{ _id: 'curator' }, {}, true],
    [{ _id: 'reader' }, {}, false],
    [{ _id: 'owner' }, { template_id: id }, true],
    [{ _id: 'reader' }, { template_id: id }, false],
  ]) {
    user = value
    let called = false
    const res = {}
    await middleware.ensureTemplateManagementAccess(
      { session: {}, params },
      res,
      () => {
        called = true
      }
    )
    assert.equal(called, allowed)
    if (!allowed) assert.equal(res.statusCode, 403)
  }
})

test('権限確認中の DB エラーは Express のエラー処理に渡す', async () => {
  queryError = new Error('DB unavailable')
  let error
  await middleware.ensureTemplateManagementAccess(
    { session: {}, params: { template_id: id } },
    {},
    (value) => {
      error = value
    }
  )
  assert.equal(error, queryError)
})

test('公開 API はギャラリーの管理権限に加えて元プロジェクトの編集権限を確認する', () => {
  const routes = []
  const webRouter = Object.fromEntries(
    ['get', 'post', 'delete'].map((method) => [
      method,
      (...args) => routes.push(args),
    ])
  )
  router.apply(webRouter)
  const route = routes.find(([path]) => path === '/template/new/:Project_id')
  assert.ok(route.indexOf(writeAccess) > 0)
  assert.ok(
    route.indexOf(writeAccess) <
      route.indexOf(controllers.createTemplateFromProject)
  )
})

function apiResponse() {
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
  }
}

test('不正な検索は API から 400 を返し、共通の 500 エラー処理へ流さない', async () => {
  const res = apiResponse()
  let forwarded = false
  await realController.getTemplateJSON(
    { query: { key: '$where', val: 'true' } },
    res,
    () => {
      forwarded = true
    }
  )
  assert.equal(res.statusCode, 400)
  assert.equal(forwarded, false)
  assert.equal(databaseReads, 0)
})

test('不正な並び替え指定も API から 400 を返す', async () => {
  const res = apiResponse()
  await realController.getCategoryTemplatesJSON(
    { query: { category: 'all', order: 'invalid' } },
    res,
    assert.fail
  )
  assert.equal(res.statusCode, 400)
})

test('DB 障害は入力エラーと区別して共通エラー処理へ渡す', async () => {
  queryError = new Error('DB unavailable')
  let forwarded
  await realController.getTemplateJSON(
    { query: { key: 'name', val: 'Lab' } },
    apiResponse(),
    (error) => {
      forwarded = error
    }
  )
  assert.equal(forwarded, queryError)
})
