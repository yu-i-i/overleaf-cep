import assert from 'node:assert/strict'
import http from 'node:http'
import { registerHooks } from 'node:module'
import { after, before, beforeEach, test } from 'node:test'
import { gzipSync } from 'node:zlib'

const settings = {
  blockedNetworks: [],
  allowedResources: null,
  maxRedirects: 2,
  fetchTimeoutMs: 1000,
  maxUploadSize: 64,
  userAgentHeader: { 'User-Agent': 'URL-proxy-test' },
}
let fixture
let proxy
let fixtureUrl
let proxyUrl
let records
let lookups
let hits
let logs
let slowClosed
let pendingDns
globalThis.__linkedUrlMocks = {
  settings,
  logger: {
    info(value) {
      logs.push(value)
    },
  },
  dns: {
    async lookup() {
      lookups++
      if (pendingDns) return new Promise(() => {})
      return records
    },
  },
}
// DNS の結果だけを制御し、接続・転送・圧縮解除・中断は実際の HTTP 通信で検証する。
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/LinkedUrlProxyController.mjs')) {
      const key = {
        '@overleaf/settings': 'settings',
        '@overleaf/logger': 'logger',
        'node:dns/promises': 'dns',
      }[specifier]
      if (key) return { url: `linked-url-mock:${key}`, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.startsWith('linked-url-mock:')) return next(url, context)
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default globalThis.__linkedUrlMocks[${JSON.stringify(url.split(':')[1])}]`,
    }
  },
})
const { default: controller, isBlockedIp } =
  await import('../app/js/LinkedUrlProxyController.mjs')

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
before(async () => {
  fixture = http.createServer((req, res) => {
    hits.push(req.url)
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/data' })
      res.end()
      return
    }
    if (req.url === '/private-redirect') {
      res.writeHead(302, { Location: 'http://127.0.0.1/private' })
      res.end()
      return
    }
    if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' })
      res.end()
      return
    }
    if (req.url === '/no-location') {
      res.writeHead(302)
      res.end()
      return
    }
    if (req.url === '/large-header') {
      res.writeHead(200, { 'Content-Length': '1024' })
      res.write('x')
      return
    }
    if (req.url === '/chunked') {
      res.writeHead(200)
      res.end('x'.repeat(128))
      return
    }
    if (req.url === '/gzip') {
      const body = gzipSync('x'.repeat(2048))
      res.writeHead(200, {
        'Content-Encoding': 'gzip',
        'Content-Length': String(body.length),
      })
      res.end(body)
      return
    }
    if (req.url === '/slow' || req.url === '/slow-body') {
      req.on('close', () => {
        slowClosed = true
      })
      if (req.url === '/slow-body') {
        res.writeHead(200)
        res.write('start')
      }
      return
    }
    if (req.url === '/missing') {
      res.writeHead(404)
      res.end('missing')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('linked data')
  })
  fixtureUrl = `http://fixture.test:${await listen(fixture)}`
  proxy = http.createServer((req, res) => {
    controller.proxy(req, res).catch((error) => {
      res.destroy()
      assert.fail(error)
    })
  })
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`
})
beforeEach(() => {
  records = [{ address: '127.0.0.1', family: 4 }]
  lookups = 0
  hits = []
  logs = []
  slowClosed = false
  pendingDns = false
  settings.allowedResources = new RegExp(
    `^${fixtureUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`
  )
  settings.blockedNetworks = []
  settings.fetchTimeoutMs = 1000
})
after(async () => {
  for (const server of [proxy, fixture]) {
    const closed = new Promise((resolve) => server.close(resolve))
    server.closeAllConnections()
    await closed
  }
})
const request = (path) =>
  fetch(`${proxyUrl}/?url=${encodeURIComponent(fixtureUrl + path)}`)

test('許可した URL を実際に取得し、検証した IP に固定して一度だけ名前解決する', async () => {
  const response = await request('/data')
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'linked data')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(lookups, 1)
})

test('エンコード済みパスと署名付きクエリを二重エンコードしない', async () => {
  const response = await request('/files/a%20b.bib?token=a%2Fb')
  assert.equal(await response.text(), 'linked data')
  assert.deepEqual(hits, ['/files/a%20b.bib?token=a%2Fb'])
})

test('許可パスをエンコードした区切り文字や親ディレクトリで迂回できない', async () => {
  settings.allowedResources = new RegExp(
    `^${fixtureUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/files/`
  )
  for (const path of [
    '/files/%252e%252e%252fprivate',
    '/files/%2F..%2Fprivate',
    '/files/%5c..%5cprivate',
  ]) {
    const response = await request(path)
    assert.equal(response.status, 403)
    await response.text()
  }
  assert.deepEqual(hits, [])
})

test('内部 IPv4・IPv6 と IPv4-mapped IPv6 を拒否する', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(isBlockedIp(address), true, address)
  assert.equal(isBlockedIp('8.8.8.8'), false)
  assert.equal(isBlockedIp('2606:4700:4700::1111'), false)
})

test('IP 直書きや数値表記のループバック URL も接続前に拒否する', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
  ]) {
    const response = await fetch(`${proxyUrl}/?url=${encodeURIComponent(url)}`)
    assert.ok(
      [400, 403].includes(response.status),
      `${url}: ${response.status}`
    )
    await response.text()
  }
  assert.deepEqual(hits, [])
})

test('名前解決の結果が空なら取得しない', async () => {
  records = []
  const response = await request('/data')
  assert.equal(response.status, 421)
  await response.text()
  assert.deepEqual(hits, [])
})

test('IPv4・IPv6 の追加 CIDR が混在しても、異なる系統で例外を出さない', () => {
  settings.blockedNetworks = ['8.8.8.0/24', '2606:4700::/32']
  assert.equal(isBlockedIp('8.8.8.8'), true)
  assert.equal(isBlockedIp('2606:4700:4700::1111'), true)
  assert.equal(isBlockedIp('1.1.1.1'), false)
  settings.blockedNetworks = ['invalid']
  assert.throws(() => isBlockedIp('1.1.1.1'))
})

test('許可設定が無ければ内部サーバーへの接続自体を拒否する', async () => {
  settings.allowedResources = null
  const response = await request('/data')
  assert.equal(response.status, 403)
  await response.text()
  assert.deepEqual(hits, [])
})

test('DNS 応答の一部が内部 IP なら接続しない', async () => {
  settings.allowedResources = null
  records = [
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]
  const response = await request('/data')
  assert.equal(response.status, 403)
  await response.text()
  assert.deepEqual(hits, [])
})

test('相対転送先を取り込むが、内部 URL への転送は別途拒否する', async () => {
  const ok = await request('/redirect')
  assert.equal(await ok.text(), 'linked data')
  const blocked = await request('/private-redirect')
  assert.equal(blocked.status, 403)
  await blocked.text()
  assert.deepEqual(hits, ['/redirect', '/data', '/private-redirect'])
})

test('転送ループと Location のない転送を打ち切る', async () => {
  for (const path of ['/loop', '/no-location']) {
    // fetch は 421 を自動再試行するため、この件数確認だけは HTTP を直接使う。
    const status = await new Promise((resolve, reject) => {
      http
        .get(
          `${proxyUrl}/?url=${encodeURIComponent(fixtureUrl + path)}`,
          (response) => {
            response.resume()
            response.on('end', () => resolve(response.statusCode))
          }
        )
        .on('error', reject)
    })
    assert.equal(status, 421)
  }
  assert.equal(hits.filter((path) => path === '/loop').length, 3)
})

test('URL 欠落・HTTP 以外・認証情報付き URL は取得前に拒否する', async () => {
  for (const url of [
    '',
    'file:///etc/passwd',
    'ftp://example.test/data',
    fixtureUrl.replace('://', '://user:password@') + '/data',
  ]) {
    const response = await fetch(`${proxyUrl}/?url=${encodeURIComponent(url)}`)
    assert.equal(response.status, 400)
    await response.text()
  }
  assert.deepEqual(hits, [])
})

test('Content-Length が上限を超えた応答は 413 を返す', async () => {
  const response = await request('/large-header')
  assert.equal(response.status, 413)
  assert.match(await response.text(), /file too large/)
})

test('長さ不明の本文と圧縮解除後の本文にも上限を適用する', async () => {
  for (const path of ['/chunked', '/gzip'])
    await assert.rejects(async () => (await request(path)).text())
})

test('ヘッダー待ちと本文待ちを同じ期限で中断する', async () => {
  settings.fetchTimeoutMs = 80
  const response = await request('/slow')
  assert.equal(response.status, 408)
  await response.text()
  await assert.rejects(async () => (await request('/slow-body')).text())
})

test('DNS 解決待ちにも取得期限を適用する', async () => {
  settings.fetchTimeoutMs = 80
  pendingDns = true
  const response = await request('/data')
  assert.equal(response.status, 408)
  await response.text()
  assert.deepEqual(hits, [])
})

test('利用者が中断したら取得元の接続も閉じる', async () => {
  const abort = new AbortController()
  const response = await fetch(
    `${proxyUrl}/?url=${encodeURIComponent(fixtureUrl + '/slow-body')}`,
    { signal: abort.signal }
  )
  abort.abort()
  await assert.rejects(response.text())
  for (let i = 0; i < 30 && !slowClosed; i++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(slowClosed, true)
})

test('取得元の失敗を返し、署名付きクエリをログへ残さない', async () => {
  const response = await request('/missing')
  assert.equal(response.status, 404)
  await response.text()
  settings.allowedResources = null
  const blocked = await request('/data?token=do-not-log')
  await blocked.text()
  assert.equal(JSON.stringify(logs).includes('do-not-log'), false)
})
