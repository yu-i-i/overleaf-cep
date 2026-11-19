import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// 接続やDBを起動せず、実ルーターが各権限ミドルウェアを登録するか確認します。
const readProject = () => {}
const login = () => {}
const admin = () => {}
globalThis.__llmRouteTest = { readProject, login, admin }
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/LLMRouter.mjs')) {
      let code
      if (specifier === '@overleaf/logger')
        code = 'export default {info(){},debug(){}}'
      if (specifier === '@overleaf/settings') code = 'export default {llm:{}}'
      if (specifier.includes('AuthenticationController'))
        code =
          'export default {requireLogin:()=>globalThis.__llmRouteTest.login}'
      if (specifier.includes('AuthorizationMiddleware'))
        code =
          'export default {ensureUserCanReadProject:globalThis.__llmRouteTest.readProject,ensureUserIsSiteAdmin:globalThis.__llmRouteTest.admin}'
      if (/^\.\/LLM.*Controller/.test(specifier))
        code = 'export default new Proxy({}, {get:()=>()=>{}})'
      if (code)
        return {
          url: 'data:text/javascript,' + encodeURIComponent(code),
          shortCircuit: true,
        }
    }
    return next(specifier, context)
  },
})
const { default: router } = await import('../src/LLMRouter.mjs')
hooks.deregister()
const routes = []
const register = (path, gate, handler) => routes.push({ path, gate, handler })
router.apply({ get: register, post: register })
delete globalThis.__llmRouteTest

test('project, user and admin endpoints enforce their respective permissions', () => {
  assert.ok(routes.length > 15)
  for (const route of routes) {
    assert.equal(typeof route.handler, 'function')
    assert.equal(
      route.gate,
      route.path.startsWith('/project/')
        ? readProject
        : route.path.startsWith('/admin/')
          ? admin
          : login,
      route.path
    )
  }
})
test('provider check and scan precede dynamic provider ids', () => {
  const paths = routes.map(route => route.path)
  assert.ok(
    paths.indexOf('/user/llm-providers/check') <
      paths.indexOf('/user/llm-providers/:id')
  )
  assert.ok(
    paths.indexOf('/user/llm-providers/scan') <
      paths.indexOf('/user/llm-providers/:id')
  )
})
test('unfinished editing and review features are not exposed', () => {
  assert.ok(
    !routes.some(route =>
      /compile-fix|\/completion$|\/generate$|\/compliance\//.test(route.path)
    )
  )
})
