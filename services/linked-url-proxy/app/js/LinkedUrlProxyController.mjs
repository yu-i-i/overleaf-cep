import dns from 'node:dns/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { posix } from 'node:path'
import ipaddr from 'ipaddr.js'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { Agent, fetch } from 'undici'

function failure(status, message) {
  const error = new Error(message)
  error.info = { status }
  return error
}

function isExplicitlyAllowed(url) {
  if (!Settings.allowedResources) return false
  const candidate = new URL(url)
  let pathname = url.pathname
  try {
    // 許可パスの判定では、二重エンコードした ../ や区切り文字も正規化する。
    // 実際の取得 URL は変更せず、署名付きクエリや %20 等をそのまま送る。
    for (let depth = 0; /%[a-f0-9]{2}/i.test(pathname); depth++) {
      if (depth >= 8) return false
      pathname = decodeURIComponent(pathname)
    }
    candidate.pathname = posix.normalize(pathname.replaceAll('\\', '/'))
  } catch {
    return false
  }
  return Settings.allowedResources.test(candidate.href)
}

export function isBlockedIp(address) {
  let addr = ipaddr.parse(address)
  // IPv4-mapped IPv6 でも IPv4 と同じ判定を行う。
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address()
  }
  if (addr.range() !== 'unicast') return true
  for (const entry of Settings.blockedNetworks) {
    let network
    try {
      network = ipaddr.parseCIDR(entry)
    } catch {
      throw failure(500, 'Invalid blocked network configuration')
    }
    // IPv4 と IPv6 の CIDR を混在させても、別系統との比較では例外を出さない。
    if (addr.kind() === network[0].kind() && addr.match(network)) return true
  }
  return false
}

async function resolveAddress(url, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let records
  if (ipaddr.isValid(hostname)) {
    records = [
      {
        address: hostname,
        family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4,
      },
    ]
  } else {
    // OS の DNS 解決待ちも、リクエスト全体の期限に含める。
    let onAbort
    try {
      signal.throwIfAborted()
      records = await Promise.race([
        dns.lookup(hostname, { all: true }),
        new Promise((_, reject) => {
          onAbort = () => reject(signal.reason)
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw failure(421, 'DNS lookup failed')
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  }
  signal.throwIfAborted()
  if (!records.length) throw failure(421, 'DNS lookup failed')
  if (!isExplicitlyAllowed(url)) {
    if (records.some((record) => isBlockedIp(record.address))) {
      throw failure(403, 'Blocked IP address')
    }
  }
  return records[0]
}

async function validateAndFetch(rawUrl, signal, agents) {
  for (let redirects = 0; redirects <= Settings.maxRedirects; redirects++) {
    let url
    try {
      url = new URL(rawUrl)
      if (url.username || url.password) throw new Error('credentials')
    } catch {
      throw failure(400, 'Invalid or unsafe URL')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw failure(400, 'Only HTTP and HTTPS URLs are allowed')
    }

    const record = await resolveAddress(url, signal)
    // fetch-utils は node-fetch を使うため、Undici の dispatcher 指定を解釈しない。
    // Undici 自身の fetch を使い、検証後に別の IP へ再解決されることを防ぐ。
    const agent = new Agent({
      connect: {
        lookup(_hostname, options, callback) {
          if (options.all) callback(null, [record])
          else callback(null, record.address, record.family)
        },
      },
    })
    agents.push(agent)
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: 'manual',
      signal,
      headers: Settings.userAgentHeader,
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      await agent.destroy()
      if (!location)
        throw failure(421, 'Redirect response missing Location header')
      // 転送先も毎回検証し、許可済みの URL から内部アドレスへ転送させない。
      rawUrl = new URL(location, url).href
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw failure(response.status, 'Upstream request failed')
    }
    if (
      Number(response.headers.get('content-length')) > Settings.maxUploadSize
    ) {
      await response.body?.cancel()
      throw failure(413, 'file too large')
    }
    return response
  }
  throw failure(421, 'Too many redirects')
}

async function proxy(req, res) {
  const controller = new AbortController()
  const agents = []
  const timer = setTimeout(
    () => controller.abort(failure(408, 'Request timed out')),
    Settings.fetchTimeoutMs
  )
  timer.unref()
  const onClose = () => {
    if (!res.writableFinished)
      controller.abort(failure(499, 'Request cancelled'))
  }
  res.once('close', onClose)
  try {
    const target = new URL(req.url, 'http://localhost').searchParams.get('url')
    if (!target) throw failure(400, 'Missing ?url parameter')
    const response = await validateAndFetch(target, controller.signal, agents)
    let received = 0
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        // Content-Length が無い応答や、圧縮後のサイズだけが小さい応答も制限する。
        if (received > Settings.maxUploadSize)
          callback(failure(413, 'file too large'))
        else callback(null, chunk)
      },
    })
    res.statusCode = response.status
    res.setHeader(
      'Content-Type',
      response.headers.get('content-type') || 'application/octet-stream'
    )
    res.setHeader('Cache-Control', 'no-store')
    await pipeline(Readable.fromWeb(response.body), limit, res, {
      signal: controller.signal,
    })
  } catch (error) {
    const reported = error.info
      ? error
      : controller.signal.aborted
        ? controller.signal.reason
        : error
    const status = reported.info?.status || 422
    // URL には認証情報や署名付きクエリが含まれ得るため、ログへそのまま残さない。
    logger.info({ status }, 'linked-url-proxy request failed')
    if (!res.destroyed && !res.headersSent) {
      res.writeHead(status, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
      })
      res.end(`Error: ${reported.message}`)
    } else if (!res.destroyed) res.destroy()
  } finally {
    clearTimeout(timer)
    res.removeListener('close', onClose)
    // 成功・中断・転送エラーのいずれでも専用コネクションを閉じる。
    await Promise.allSettled(agents.map((agent) => agent.destroy()))
  }
}

export default { proxy }
