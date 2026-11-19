import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEditorContext,
  validChatMessages,
} from '../src/LLMChatContext.mjs'
import { fitContextBlocks } from '../src/LLMContextBudget.mjs'

test('live editor context preserves LaTeX and selection as reference data', () => {
  const snapshot = {
    file: '/chapters/main.tex',
    text: '\\section{最新}',
    from: 123,
    selection: '最新',
    truncated: true,
  }
  assert.deepEqual(JSON.parse(buildEditorContext(snapshot)), snapshot)
})
test('malformed and oversized editor snapshots are rejected', () => {
  for (const value of [
    null,
    {},
    { file: 'a', text: 'a', from: -1 },
    { file: 'a', text: 'a'.repeat(20001), from: 0 },
  ]) {
    assert.equal(buildEditorContext(value), null)
  }
})
test('conversation accepts only supported roles and bounded text', () => {
  assert.equal(validChatMessages([{ role: 'user', content: 'help' }]), true)
  for (const messages of [
    [],
    [null],
    [{ role: 'tool', content: 'a' }],
    [{ role: 'user', content: {} }],
    Array(101).fill({ role: 'user', content: 'a' }),
    Array(3).fill({ role: 'user', content: 'a'.repeat(100000) }),
  ]) {
    assert.equal(validChatMessages(messages), false)
  }
})
test('references include only source blocks actually delivered within the budget', () => {
  const result = fitContextBlocks(
    [
      'Files: a.tex, b.tex',
      'FILE a.tex\n' + 'a'.repeat(3000),
      'FILE b.tex\n' + 'b'.repeat(1000),
    ],
    ['a.tex', 'b.tex'],
    2000
  )
  assert.ok(result.context.length <= 2000)
  assert.deepEqual(result.files, ['a.tex'])
  assert.match(result.context, /以降省略/)
  assert.doesNotMatch(result.context, /FILE b.tex/)
})
test('budget fitter deduplicates files and can skip oversized headings', () => {
  const result = fitContextBlocks(
    ['list', 'x'.repeat(500) + '\nabc', 'a\nsource', 'a\nmore'],
    ['bad.tex', 'a.tex', 'a.tex'],
    250
  )
  assert.deepEqual(result.files, ['a.tex'])
  assert.ok(result.context.length <= 250)
})
