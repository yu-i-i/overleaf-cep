import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// Mongoを起動せず、日次カウンターの検索先と保存先が一致することを検証します。
const reads = [],
  writes = [],
  indexes = []
globalThis.__llmBudgetCollection = {
  createIndex: async (...args) => indexes.push(args),
  findOneAndUpdate: async (...args) => {
    writes.push(args)
    return { calls: 1 }
  },
  findOne: async query => {
    reads.push(query)
    return { day: new Date().toISOString().slice(0, 10), tokens: 0 }
  },
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/LLMBudget.mjs')) {
      const code = specifier.includes('Mongoose')
        ? 'export default {connection:{collection:()=>globalThis.__llmBudgetCollection}}'
        : specifier === '@overleaf/logger'
          ? 'export default {warn(){}}'
          : null
      if (code)
        return {
          url: 'data:text/javascript,' + encodeURIComponent(code),
          shortCircuit: true,
        }
    }
    return next(specifier, context)
  },
})
const { guardLLMCall } = await import('../src/LLMBudget.mjs')
hooks.deregister()
test('minute and day counters are separate and use an expiring Date field', async () => {
  const guard = await guardLLMCall('user')
  guard.record(50)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes.length, 2)
  assert.notDeepEqual(writes[0][0], writes[1][0])
  assert.deepEqual(reads[0], writes[1][0])
  assert.equal(writes[1][1].$inc.tokens, 50)
  assert.ok(writes[0][1].$set.expiresAt instanceof Date)
  assert.ok(writes[1][1].$set.expiresAt instanceof Date)
  assert.ok(
    indexes.some(
      ([fields, options]) =>
        fields.expiresAt && options.expireAfterSeconds === 0
    )
  )
})
test('anonymous calls do not create usage counters', async () => {
  const before = writes.length
  const guard = await guardLLMCall(null)
  guard.record(20)
  assert.equal(writes.length, before)
})
