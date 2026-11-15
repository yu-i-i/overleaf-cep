import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isValidSnapshot } from '../app/src/GitBridgeSnapshotValidation.mjs'

const project = 'a'.repeat(24)
const base = 'http://git-bridge:8000'
function snapshot() {
  return {
    latestVerId: 3,
    postbackUrl: `${base}/api/${project}/123abc/postback`,
    files: [
      { name: 'main.tex', url: `${base}/api/${project}/file-id?key=123abc` },
      { name: 'unchanged.tex' },
      { name: 'figure.png', url: null },
    ],
  }
}
const valid = (body) => isValidSnapshot(body, project, base)

test('変更・未変更ファイルと空プロジェクトの push を受け付ける', () => {
  assert.equal(valid(snapshot()), true)
  assert.equal(valid({ ...snapshot(), files: [] }), true)
})

test('通知先を別ホスト・別プロジェクト・管理 API に差し替えられない', () => {
  for (const url of [
    'http://mongo:27017/',
    `${base}/api/${'b'.repeat(24)}/123abc/postback`,
    `${base}/api/projects`,
    `${base}/api/${project}/123abc/postback?extra=1`,
    `${base}/api/${project}/123abc/postback#fragment`,
    `http://user:pass@git-bridge:8000/api/${project}/123abc/postback`,
  ])
    assert.equal(valid({ ...snapshot(), postbackUrl: url }), false, url)
})

test('取得先も同じプロジェクトと通知キーに限定する', () => {
  for (const url of [
    'http://127.0.0.1:3100/api',
    `${base}/api/${'b'.repeat(24)}/file-id?key=123abc`,
    `${base}/api/${project}/file-id?key=other`,
    `${base}/api/${project}/file-id?key=123abc&key=123abc`,
    `${base}/api/${project}/file-id?key=123abc&redirect=1`,
    `${base}/api/${project}/../file-id?key=123abc`,
  ])
    assert.equal(
      valid({ ...snapshot(), files: [{ name: 'a', url }] }),
      false,
      url
    )
})

test('不正なバージョン・ファイル一覧を処理前に拒否する', () => {
  for (const body of [
    undefined,
    {},
    { ...snapshot(), latestVerId: '3' },
    { ...snapshot(), latestVerId: -1 },
    { ...snapshot(), files: null },
    { ...snapshot(), files: [null] },
    { ...snapshot(), files: [{ name: 'a' }, { name: 'a' }] },
    { ...snapshot(), files: [{ name: 1 }] },
  ])
    assert.equal(valid(body), false)
})
