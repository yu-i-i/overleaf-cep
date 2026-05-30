import dns from 'dns/promises'
import { sanitizeUrl } from 'strict-url-sanitise'
import normalizeUrlPath from 'als-normalize-urlpath'
import ipaddr from 'ipaddr.js'
import { URL } from 'node:url'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { fetchStreamWithResponse, RequestFailedError } from '@overleaf/fetch-utils'
import { Agent } from 'undici'

export function isAllowedResource(targetUrl) {
  if (!Settings.allowedResources) return false
  return Settings.allowedResources.test(targetUrl)
}

export function isBlockedIp(ipStr, targetUrl) {
  const addr = ipaddr.parse(ipStr)
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    return isBlockedIp(addr.toIPv4Address().toString(), targetUrl)
  }

  if (addr.range() !== 'unicast') {
    return true
  }

  for (const blocked of Settings.blockedNetworks) {
    try {
      const net = ipaddr.parseCIDR(blocked)
      if (addr.match(net)) return true
    } catch (e) {
      logger.error({ blocked, error: e }, 'Invalid blockedNetworks entry')
      const err = new Error(`Invalid blockedNetworks entry: ${blocked}`)
      err.info = { status: 500 }
      throw err
    }
  }
  return false
}

async function checkUrlAccess(hostname, targetUrl) {
  const records = await dns.lookup(hostname, { all: true }).catch(() => [])
  if (!records.length) {
    const err = new Error('DNS lookup failed')
    err.info = { status: 421 }
    throw err
  }
  // Permit explicitly allowed resources without checking blocked IPs.
  if (isAllowedResource(targetUrl)) return records[0].address
  for (const { address } of records) {
    if (isBlockedIp(address, targetUrl)) {
      const err = new Error('Blocked network target')
      err.info = { status: 403 }
      throw err
    }
  }
  return records[0].address
}

export async function validateAndFetch(rawUrl, redirectCount = 0) {
  if (redirectCount > Settings.maxRedirects) {
    const err = new Error('Too many redirects')
    err.info = { status: 421 }
    throw err
  }

  const sanitizedUrl = sanitizeUrl(rawUrl)
  if (!sanitizedUrl) {
    const err = new Error('Invalid or unsafe URL')
    err.info = { status: 400 }
    throw err
  }

  const url = new URL(sanitizedUrl)

  if (!['http:', 'https:'].includes(url.protocol)) {
    const err = new Error(`${url.protocol} protocol is not allowed`)
    err.info = { status: 400 }
    throw err
  }

  const normalizedPath = normalizeUrlPath(url.pathname).pathname

  if (!normalizedPath) {
    const err = new Error('Invalid or unsafe URL path')
    err.info = { status: 400 }
    throw err
  }
  url.pathname = normalizedPath

  const normalizedUrl = url.toString()

  // check DNS and allowed resources
  const validatedIp = await checkUrlAccess(url.hostname, normalizedUrl)

  // pin fetch to validated IP to prevent DNS rebinding
  const agent = new Agent({
    connect: {
      lookup(hostname, opts, cb) {
        const family = ipaddr.parse(validatedIp).kind() === 'ipv6' ? 6 : 4
        cb(null, validatedIp, family)
      },
    },
  })

  const opts = {
    redirect: 'manual',
    timeout: Settings.fetchTimeoutMs,
    headers: Settings.userAgentHeader,
  }

  try {
    const { stream, response } = await fetchStreamWithResponse(normalizedUrl, {
      ...opts,
      dispatcher: agent,
    })

    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader) {
      const n = parseInt(contentLengthHeader, 10)
      if (!Number.isNaN(n) && n > Settings.maxUploadSize) {
        const err = new Error('file too large')
        err.info = { status: 413 }
        try {
          stream.destroy()
        } catch (_) {}
        throw err
      }
    }

    return {
      stream,
      response,
      headers: Object.fromEntries(response.headers.entries()),
    }
  } catch (err) {
    if (err instanceof RequestFailedError) {
      const status = err.info.status

      // Handle redirects
      if (status >= 300 && status < 400) {
        const location = err.response.headers.get('Location')
        if (location) {
          const nextUrl = new URL(location, normalizedUrl).toString()
          return validateAndFetch(nextUrl, redirectCount + 1)
        } else {
          const e = new Error('Redirect response missing Location header')
          e.info = { status: 421 }
          throw e
        }
      }
      throw err
    }
    if (!err?.info?.status) {
      if (err.type === 'request-timeout') {
        err.info = { status: 408 }
      } else err.info = { status: 422 }
    }
    throw err
  }
}

async function proxy(req, res) {
  if (!Settings.externalUrlImportEnabled) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    res.end('External URL import is disabled')
    return
  }

  try {
    const u = new URL(req.url, `http://${req.headers.host}`)
    const targetUrl = u.searchParams.get('url')
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing ?url parameter')
      return
    }

    const {
      stream: upstreamStream,
      response,
      headers,
    } = await validateAndFetch(targetUrl)

    res.statusCode = response.status || 200
    res.setHeader(
      'Content-Type',
      headers['content-type'] || 'application/octet-stream'
    )
    res.setHeader('Cache-Control', 'no-store')

    function onError(err) {
      logger.info({ err, url: req.url }, 'linked-url-proxy request failed')
      try {
        upstreamStream.destroy()
      } catch (_) {}
      if (!res.headersSent) {
        res.writeHead(err?.info?.status || 503, {
          'Content-Type': 'text/plain',
        })
        res.end('Error: linked URL import failed')
      } else {
        try {
          res.destroy()
        } catch (_) {}
      }
    }

    upstreamStream.on('error', onError)
    upstreamStream.pipe(res)
  } catch (err) {
    const status = err.info?.status || 500
    logger.info(
      { linkedUrl: err.message, status, url: req.url },
      'linked-url-proxy request failed'
    )
    try {
      res.writeHead(status, { 'Content-Type': 'text/plain' })
      res.end('Error: linked URL import failed')
    } catch {
      try {
        res.end()
      } catch {}
    }
  }
}

export default { proxy }
