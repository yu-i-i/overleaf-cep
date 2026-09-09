#!/usr/bin/env node

import express from 'express'
import { WebDAVClient } from './WebDAVClient.mjs'
import { sanitizeUrlForLogging } from './auth.mjs'

const app = express()
app.use(express.json({ limit: '50mb' })) // files can be large; match dropboxinterface

// --- Service authentication (ARC-02) -------------------------------------------------------
// Enforced when SHARED_SERVICE_TOKEN is configured; when unset (legacy
// deployments) the service keeps accepting unauthenticated calls and warns,
// so existing in-container deployments keep working.
import crypto from 'node:crypto'
const SERVICE_TOKEN = process.env.SHARED_SERVICE_TOKEN || ''
let serviceAuthWarned = false
function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    if (!serviceAuthWarned) {
      serviceAuthWarned = true
      console.warn(
        'SHARED_SERVICE_TOKEN is unset; accepting unauthenticated requests (should be restricted to in-container callers)'
      )
    }
    return next()
  }
  const authHeader = req.headers.authorization || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const candidate = String(req.headers['x-service-token'] || bearer || '')
  const candidateBuffer = Buffer.from(candidate)
  const expectedBuffer = Buffer.from(SERVICE_TOKEN)
  const ok =
    candidateBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
  if (!ok) {
    return res.status(401).json({ error: 'Invalid or missing service token' })
  }
  return next()
}
app.use(requireServiceToken)

// --- Error sanitization (H8/M9) -------------------------------------------------------
// The webdav client embeds `user:pass@host` URLs into error messages. Provider
// error text must never reach logs or clients verbatim:
//   - safeError(err): string for LOGS with credential-looking URLs redacted
//   - providerStatusError(err): generic {status, error} for RESPONSES (no provider text)
const CREDENTIAL_URL_RE = /(https?|webdav):\/\/[^@\s]+@/gi
function safeError(err) {
  const raw = err && (err.message || err.error) ? String(err.message || err.error) : 'unknown error'
  return raw.replace(CREDENTIAL_URL_RE, '$1://<redacted>@').slice(0, 1000)
}
function providerStatusError(err) {
  const status = err && (err.status || err.statusCode)
  const msg = (err && err.message) || ''
  if (status === 401 || /unauthorized|authentication|invalid (token|credential)/i.test(msg)) {
    return { status: 401, error: 'authentication failed' }
  }
  if (status === 404 || /not found|no such/i.test(msg)) {
    return { status: 404, error: 'not found' }
  }
  if (status === 409 || status === 412 || /conflict|precondition/i.test(msg)) {
    return { status: 409, error: 'modified since last sync' }
  }
  return { status: 502, error: 'provider request failed' }
}
function logProviderError(label, err, url) {
  console.error(label, safeError(err), url ? sanitizeUrlForLogging(url) : '')
}

/**
 * POST /check - Verify credentials work with the WebDAV server
 */
app.post('/check', async (req, res) => {
  try {
    const { server_url, username, password } = req.body
    
    if (!server_url || !username || !password) {
      return res.status(400).json({ error: 'Missing required fields: server_url, username, password' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.check()
    res.json({ status: 'ok', message: 'Connection successful' })
  } catch (err) {
    logProviderError('WebDAV check failed:', err, req.body?.server_url)
    const mapped = providerStatusError(err)
    res.status(mapped.status).json({ error: mapped.error })
  }
})

/**
 * POST /list - List directory contents
 */
app.post('/list', async (req, res) => {
  try {
    const { server_url, username, password, path } = req.body
    
    if (!server_url || !username || !password || !path) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    const entries = await client.list(path)
    res.json({ entries })
  } catch (err) {
    logProviderError('WebDAV list failed:', err, req.body?.server_url)
    const mapped = providerStatusError(err)
    res.status(mapped.status).json({ error: mapped.error })
  }
})

/**
 * POST /mkdir - Create directory
 */
app.post('/mkdir', async (req, res) => {
  try {
    const { server_url, username, password, path } = req.body
    
    if (!server_url || !username || !password || !path) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.createDirectory(path)
    res.json({ status: 'ok', created: true })
  } catch (err) {
    logProviderError('WebDAV mkdir failed:', err, req.body?.server_url)
    if (err.status === 405 || err.message?.includes('already exists')) {
      return res.status(200).json({ status: 'ok', created: false, message: 'Directory already exists' })
    }
    const mapped = providerStatusError(err)
    res.status(mapped.status).json({ error: mapped.error })
  }
})

/**
 * GET /file - Get file content (params in query)
 */
app.get('/file', async (req, res) => {
  try {
    const path = req.query.path
    const serverUrl = req.headers['x-server-url']
    const username = req.headers['x-username']

    if (!path || !serverUrl) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    // M9: the Authorization (Basic) header is the ONLY credential path for GETs
    // (the req.body password fallback was removed — GETs-with-body are discarded
    // by most clients/proxies anyway).
    const authHeader = req.headers.authorization
    let password
    if (authHeader && authHeader.startsWith('Basic ')) {
      // WI-05: split on the FIRST ':' — usernames containing ':' used to break this
      const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString()
      const separator = decoded.indexOf(':')
      password = separator === -1 ? '' : decoded.slice(separator + 1)
    }

    if (!password) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const client = new WebDAVClient({
      baseUrl: serverUrl,
      username,
      password
    })

    const contentBase64 = await client.download(path)
    res.json({
      path,
      content_base64: contentBase64
    })
  } catch (err) {
    // F2.1: accessToken/serverUrl are consts inside the try block — re-derive
    // from req (guaranteed in scope) for the scrub arg.
    logProviderError('WebDAV get file failed:', err, req.headers['x-server-url'])
    if (err?.status === 404) {
      return res.status(404).json({ error: 'not found' })
    }
    const mapped = providerStatusError(err)
    res.status(mapped.status).json({ error: mapped.error })
  }
})

/**
 * POST /file - Upload/create file
 */
app.post('/file', async (req, res) => {
  try {
    const { server_url, username, password, path, content_base64, etag } = req.body
    
    if (!server_url || !username || !password || !path || content_base64 === undefined) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.upload(path, content_base64, { etag })
    res.json({ status: 'ok', uploaded: true })
  } catch (err) {
    logProviderError('WebDAV upload failed:', err, req.body?.server_url)
    if (err?.status === 412 || /precondition|conflict/i.test(err?.message || '')) {
      return res.status(412).json({ error: 'ETag mismatch - file modified', status: 412 })
    }
    if (err?.status === 404) {
      return res.status(404).json({ error: 'parent path not found' })
    }
    const mapped = providerStatusError(err)
    res.status(mapped.status).json({ error: mapped.error })
  }
})

/**
 * DELETE /file - Delete file
 */
app.delete('/file', async (req, res) => {
  try {
    const path = req.query.path
    const serverUrl = req.headers['x-server-url']
    const username = req.headers['x-username']

    if (!path || !serverUrl) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    // Extract password from Authorization header or body
    const authHeader = req.headers.authorization
    let password
    if (authHeader && authHeader.startsWith('Basic ')) {
      // WI-05: split on the FIRST ':' — usernames containing ':' used to break this
      const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString()
      const separator = decoded.indexOf(':')
      password = separator === -1 ? '' : decoded.slice(separator + 1)
    }

    if (!password) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const client = new WebDAVClient({
      baseUrl: serverUrl,
      username,
      password
    })

    await client.delete(path)
    res.json({ status: 'ok', deleted: true })
  } catch (err) {
    logProviderError('WebDAV delete failed:', err, req.headers['x-server-url'])
    if (err.status === 404 || err.message?.includes('not found')) {
      return res.status(200).json({ status: 'ok', notFound: true, message: 'File not found' })
    }
    const mapped = providerStatusError(err)
    res.status(mapped.status).json({ error: mapped.error })
  }
})

/**
 * POST /move - Move/rename file
 */
app.post('/move', async (req, res) => {
  try {
    const { server_url, username, password, src, dst } = req.body
    
    if (!server_url || !username || !password || !src || !dst) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.move(src, dst)
    res.json({ status: 'ok', moved: true })
  } catch (err) {
    logProviderError('WebDAV move failed:', err, req.body?.server_url)
    const mapped = providerStatusError(err)
    res.status(mapped.status).json({ error: mapped.error })
  }
})

// Start server
const PORT = process.env.WEBDAVINTERFACE_PORT || 4002

app.listen(PORT, () => {
  console.log(`WebDAVInterface service running on port ${PORT}`)
})

export default app
