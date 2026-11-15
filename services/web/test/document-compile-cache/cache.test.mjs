import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compileResultKey,
  DocumentCompileCache,
} from '../../frontend/js/features/pdf-preview/util/document-compile-cache.ts'

function result(
  id,
  status = 'success',
  outputFiles = [{ path: 'output.pdf' }]
) {
  return { rootDocId: id, status, outputFiles, options: {} }
}

test('文書 ID を優先し、プロジェクトとパスによる代替を区別する', () => {
  assert.equal(compileResultKey('p', 'a', 'renamed.tex'), 'p:doc:a')
  assert.equal(compileResultKey('p', null, 'main.tex'), 'p:path:main.tex')
  assert.equal(compileResultKey('p', null), null)
  assert.notEqual(compileResultKey('p', 'a'), compileResultKey('q', 'a'))
})

test('未コンパイル文書を経由しても、元の文書の成功結果を復元できる', () => {
  const cache = new DocumentCompileCache()
  const japanese = result('ja')
  const english = result('en')
  cache.put('p', japanese, false)
  assert.equal(cache.peek('p:doc:en'), undefined)
  cache.put('p', english, false)
  assert.equal(cache.peek('p:doc:ja').data, japanese)
  assert.equal(cache.peek('p:doc:en').data, english)
})

test('失敗・PDF のない成功・文書不明の結果で成功 PDF を失わない', () => {
  const cache = new DocumentCompileCache()
  const successful = result('ja')
  cache.put('p', successful, false)
  cache.put('p', result('ja', 'failure'), false)
  cache.put('p', result('ja', 'success', []), false)
  cache.put('p', result(null), false)
  assert.equal(cache.peek('p:doc:ja').data, successful)
  assert.equal(cache.peek(null), undefined)
})

test('共有ファイルへの編集で全結果が古くなり、再コンパイルした文書だけ更新される', () => {
  const cache = new DocumentCompileCache()
  cache.put('p', result('ja'), false)
  cache.put('p', result('en'), false)
  cache.invalidate()
  assert.equal(cache.peek('p:doc:ja').stale, true)
  assert.equal(cache.peek('p:doc:en').stale, true)
  cache.put('p', result('en'), false)
  assert.equal(cache.peek('p:doc:ja').stale, true)
  assert.equal(cache.peek('p:doc:en').stale, false)
})

test('コンパイル中に編集された成功結果も古い扱いになる', () => {
  const cache = new DocumentCompileCache()
  cache.put('p', result('ja'), true)
  assert.equal(cache.peek('p:doc:ja').stale, true)
})

test('最大 4 件を保持し、復元された結果は LRU の削除対象から外れる', () => {
  const cache = new DocumentCompileCache()
  for (const id of ['a', 'b', 'c', 'd']) cache.put('p', result(id), false)
  cache.touch('p:doc:a')
  cache.put('p', result('e'), false)
  assert.equal(cache.peek('p:doc:b'), undefined)
  for (const id of ['a', 'c', 'd', 'e']) assert.ok(cache.peek(`p:doc:${id}`))
  cache.put('p', result('a'), false)
  cache.put('p', result('f'), false)
  assert.equal(cache.peek('p:doc:c'), undefined)
})

test('キャッシュ削除後は以前の文書を復元しない', () => {
  const cache = new DocumentCompileCache()
  cache.put('p', result('ja'), false)
  cache.clear()
  assert.equal(cache.peek('p:doc:ja'), undefined)
})
