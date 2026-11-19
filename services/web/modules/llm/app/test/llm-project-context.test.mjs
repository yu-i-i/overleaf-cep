import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const docs = {
  '/paper.tex': { lines: ['\\documentclass{article}', 'source '.repeat(1500)] },
  '/a/main.tex': { lines: ['Unique chapter A', 'chapter '.repeat(1000)] },
  '/b/main.tex': { lines: ['Unique chapter B', 'content '.repeat(1000)] },
  '/image.svg': { lines: ['not source'] },
}
// Exercise the real context builder without starting mongo/docstore services.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/LLMProjectContext.mjs')) {
      let source
      if (specifier.includes('ProjectEntityHandler'))
        source = `export default {promises:{getAllDocs:async()=>(${JSON.stringify(docs)})}}`
      if (specifier === '@overleaf/logger')
        source = 'export default {debug(){}}'
      if (source)
        return {
          url: 'data:text/javascript,' + encodeURIComponent(source),
          shortCircuit: true,
        }
    }
    return next(specifier, context)
  },
})
const { buildProjectContext } = await import('../src/LLMProjectContext.mjs')
hooks.deregister()

test('automatic context respects the budget and reports only delivered source', async () => {
  const result = await buildProjectContext('project', 'help', '/a/main.tex', {
    budgetChars: 2000,
  })
  assert.ok(result.context.length <= 2000)
  assert.deepEqual(result.files, ['/a/main.tex'])
  assert.match(result.context, /Unique chapter A/)
  assert.doesNotMatch(result.context, /Unique chapter B/)
  assert.doesNotMatch(result.context, /image.svg/)
})
test('full context stays within budget and marks omitted source', async () => {
  const result = await buildProjectContext('project', 'help', '/b/main.tex', {
    mode: 'full',
    budgetChars: 2000,
  })
  assert.ok(result.context.length <= 2000)
  assert.deepEqual(result.files, ['/b/main.tex'])
  assert.match(result.context, /Unique chapter B/)
  assert.match(result.context, /切断/)
})
test('ambiguous legacy basenames do not select an arbitrary active file', async () => {
  const result = await buildProjectContext('project', 'help', 'main.tex', {
    budgetChars: 2000,
  })
  assert.doesNotMatch(result.context, /編集中のファイル/)
})
test('a focused active file is included once and references are unique', async () => {
  const result = await buildProjectContext(
    'project',
    'a/main.tex',
    '/a/main.tex',
    { budgetChars: 4000 }
  )
  assert.equal(result.files.length, new Set(result.files).size)
  assert.doesNotMatch(result.context, /編集中のファイル/)
  assert.ok(result.context.length <= 4000)
})
