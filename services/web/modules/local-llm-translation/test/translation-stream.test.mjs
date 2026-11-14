import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  maskPartialMarkers,
  readTranslationStream,
} from '../frontend/js/translation-stream.ts'

const complete = {
  type: 'complete',
  text: 'English 日本語',
  model: 'test-model',
  chunks: 1,
  protected_tokens: 0,
  failed_chunks: [],
}

function streamText(text, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      for (let cursor = 0; cursor < bytes.length; cursor += chunkSize) {
        controller.enqueue(bytes.slice(cursor, cursor + chunkSize))
      }
      controller.close()
    },
  })
}

test('UTF-8 と CRLF が任意のバイト境界で分割されても SSE を読める', async () => {
  const progress = { type: 'progress', message: '処理中', chunk: 1, total: 1 }
  const text = [progress, complete]
    .map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`)
    .join('')
  for (const size of [1, 2, 7, 31, 1000]) {
    const events = []
    const result = await readTranslationStream(
      streamText(text, size),
      (event) => events.push(event)
    )
    assert.deepEqual(result, complete)
    assert.deepEqual(events, [progress, complete])
  }
})

test('完了前に接続が終わった場合は保存可能な結果として扱わない', async () => {
  const stream = streamText('data: {"type":"delta","text":"partial"}\n\n')
  await assert.rejects(
    readTranslationStream(stream, () => {}),
    /完了イベント/
  )
})

test('SSE の error を表示用の例外にする', async () => {
  const stream = streamText('data: {"type":"error","detail":"failed"}\n\n')
  await assert.rejects(
    readTranslationStream(stream, () => {}),
    /failed/
  )
})

test('イベント解析に失敗した場合は受信元をキャンセルする', async () => {
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: invalid\n\n'))
    },
    cancel() {
      cancelled = true
    },
  })
  await assert.rejects(
    readTranslationStream(stream, () => {}),
    SyntaxError
  )
  assert.equal(cancelled, true)
})

test('プレビューでは分割された保護マーカーを隠す', () => {
  assert.equal(
    maskPartialMarkers('Text QZPROTECTED000000XZQ end'),
    'Text … end'
  )
  for (const suffix of [
    'QZ',
    'QZPROTECTED',
    'QZPROTECTED000',
    'QZPROTECTED000000XZ',
  ]) {
    assert.equal(maskPartialMarkers('Text ' + suffix), 'Text ')
  }
  assert.equal(maskPartialMarkers('Plain English.'), 'Plain English.')
})
