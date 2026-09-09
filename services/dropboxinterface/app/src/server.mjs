#!/usr/bin/env node
/**
 * Dropbox Interface HTTP Server
 *
 * Provides RESTful endpoints for Dropbox API operations.
 */

import express from 'express'
import { DropboxClient } from './DropboxClient.mjs'
import {
  validateToken,
  sanitizeTokenForLogging,
  extractAccessToken
} from './auth.mjs'
import logger from '@overleaf/logger'

const app = express()
app.use(express.json({ limit: '50mb' })) // Dropbox files can be large

// Apply token extraction middleware to all routes
app.use(extractAccessToken)

/**
 * GET /health - Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'dropboxinterface'
  })
})

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

// F2.2 / H8: scrub + truncate provider error text so it is safe for logs
// and responses (Dropbox error bodies are provider text, not credentials —
// but a leaked token value must never travel in either).
function safeProviderError(err, token) {
  let msg = err && err.message ? String(err.message) : ''
  if (token) msg = msg.split(token).join('<redacted-token>')
  msg = msg.replace(/access[_-]?token[=:'"\s]+[A-Za-z0-9._~+-]+/gi, 'access_token=<redacted>')
  return msg.slice(0, 500)
}

/**
 * POST /check - Verify credentials work with Dropbox
 */
app.post('/check', async (req, res) => {
  try {
    const accessToken = req.body?.access_token || req.dropboxToken

    if (!accessToken) {
      return res.status(400).json({
        error: 'Missing access token. Use body parameter or X-Access-Token header.'
      })
    }

    validateToken(accessToken)
    logger.debug(
      { tokenHash: sanitizeTokenForLogging(accessToken) },
      'Checking Dropbox connection'
    )

    const client = new DropboxClient({ accessToken })
    await client.check()

    res.json({ status: 'ok', message: 'Connection successful' })
  } catch (err) {
    console.error('Dropbox check failed:', safeProviderError(err, req.body?.access_token || req.dropboxToken))

    if (err.statusCode === 401) {
      return res
        .status(401)
        .json({ error: 'Invalid or expired access token', statusCode: 401 })
    }

    res
      .status(err.statusCode || 500)
      .json({
        error: safeProviderError(err, req.body?.access_token || req.dropboxToken) || 'Connection failed',
        statusCode: err.statusCode
      })
  }
})

/**
 * POST /list - List directory contents
 */
app.post('/list', async (req, res) => {
  try {
    const { path = '', recursive = false } = req.body
    const accessToken = req.body?.access_token || req.dropboxToken

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing access token' })
    }

    validateToken(accessToken)
    logger.debug(
      { tokenHash: sanitizeTokenForLogging(accessToken), path },
      'Listing Dropbox directory'
    )

    const client = new DropboxClient({ accessToken })
    const result = await client.list(path, { recursive })

    res.json(result)
  } catch (err) {
    console.error('Dropbox list failed:', safeProviderError(err, req.body?.access_token || req.dropboxToken))

    if (err.statusCode === 401) return res.status(401).json({ error: 'Invalid token' })
    if (err.statusCode === 403) return res.status(403).json({ error: 'Permission denied' })
    if (err.statusCode === 404) return res.status(404).json({ error: 'Path not found' })

    res
      .status(err.statusCode || 500)
      .json({ error: safeProviderError(err, req.body?.access_token || req.dropboxToken) || 'List failed' })
  }
})

/**
 * POST /mkdir - Create directory
 */
app.post('/mkdir', async (req, res) => {
  try {
    const { path } = req.body
    const accessToken = req.body?.access_token || req.dropboxToken

    if (!accessToken || !path) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    validateToken(accessToken)
    logger.debug(
      { tokenHash: sanitizeTokenForLogging(accessToken), path },
      'Creating Dropbox directory'
    )

    const client = new DropboxClient({ accessToken })
    const result = await client.createDirectory(path)

    res.json(result)
  } catch (err) {
    console.error('Dropbox mkdir failed:', safeProviderError(err, req.body?.access_token || req.dropboxToken))

    if (err.statusCode === 401) return res.status(401).json({ error: 'Invalid token' })
    if (err.statusCode === 409)
      return res
        .status(200)
        .json({
          status: 'ok',
          created: false,
          message: safeProviderError(err, req.body?.access_token || req.dropboxToken) || 'Directory already exists'
        })

    res
      .status(err.statusCode || 500)
      .json({ error: safeProviderError(err, req.body?.access_token || req.dropboxToken) || 'Create directory failed' })
  }
})

/**
 * GET /file - Download file (using headers for auth)
 */
app.get('/file', async (req, res) => {
  try {
    const path = req.headers['x-path'] || req.query.path
    const accessToken = req.headers['x-access-token'] || req.dropboxToken

    if (!accessToken || !path) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    validateToken(accessToken)
    logger.debug(
      { tokenHash: sanitizeTokenForLogging(accessToken), path },
      'Downloading Dropbox file'
    )

    const client = new DropboxClient({ accessToken })
    const result = await client.download(path)

    if (result.notFound) {
      return res.status(404).json({ error: 'File not found' })
    }

    res.json({
      relative_path: path.replace(/^\//, ''),
      content_base64: result
    })
  } catch (err) {
    console.error('Dropbox download failed:', safeProviderError(err, req.headers['x-access-token'] || req.dropboxToken))

    if (err.statusCode === 401) return res.status(401).json({ error: 'Invalid token' })
    if (err.statusCode === 404) return res.status(404).json({ error: 'File not found' })

    res
      .status(err.statusCode || 500)
      .json({ error: safeProviderError(err, req.headers['x-access-token'] || req.dropboxToken) || 'Download failed' })
  }
})

/**
 * POST /file - Upload file
 */
app.post('/file', async (req, res) => {
  try {
    const { path, content_base64, mode = 'overwrite', rev } = req.body
    const accessToken = req.body?.access_token || req.dropboxToken

    if (!accessToken || !path || content_base64 === undefined) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    validateToken(accessToken)
    logger.debug(
      { tokenHash: sanitizeTokenForLogging(accessToken), path, mode },
      'Uploading to Dropbox'
    )

    const client = new DropboxClient({ accessToken })
    const result = await client.upload(path, content_base64, {
      mode: rev ? 'update' : mode,
      rev
    })

    res.json({
      status: 'ok',
      uploaded: true,
      revision: result.revision,
      dropbox_id: result.dropbox_id
    })
  } catch (err) {
    console.error('Dropbox upload failed:', safeProviderError(err, req.body?.access_token || req.dropboxToken))

    if (err.statusCode === 401) return res.status(401).json({ error: 'Invalid token' })
    if (err.message?.includes('conflict')) {
      return res
        .status(412)
        .json({
          error: 'Upload conflict: File modified on server',
          status: 412
        })
    }

    res
      .status(err.statusCode || 500)
      .json({ error: safeProviderError(err, req.body?.access_token || req.dropboxToken) || 'Upload failed' })
  }
})

/**
 * DELETE /file - Delete file
 */
app.delete('/file', async (req, res) => {
  try {
    const path = req.headers['x-path'] || req.query.path
    const accessToken = req.headers['x-access-token'] || req.dropboxToken

    if (!accessToken || !path) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    validateToken(accessToken)
    logger.debug(
      { tokenHash: sanitizeTokenForLogging(accessToken), path },
      'Deleting Dropbox file'
    )

    const client = new DropboxClient({ accessToken })
    await client.delete(path)

    res.json({ status: 'ok', deleted: true })
  } catch (err) {
    console.error('Dropbox delete failed:', safeProviderError(err, req.headers['x-access-token'] || req.dropboxToken))

    if (err.statusCode === 401) return res.status(401).json({ error: 'Invalid token' })
    if (err.statusCode === 404)
      return res
        .status(200)
        .json({
          status: 'ok',
          notFound: true,
          message: 'File already removed or never existed'
        })

    res
      .status(err.statusCode || 500)
      .json({ error: safeProviderError(err, req.headers['x-access-token'] || req.dropboxToken) || 'Delete failed' })
  }
})

/**
 * POST /move - Move/rename file
 */
app.post('/move', async (req, res) => {
  try {
    const { src, dst } = req.body
    const accessToken = req.body?.access_token || req.dropboxToken

    if (!accessToken || !src || !dst) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    validateToken(accessToken)
    logger.debug(
      { tokenHash: sanitizeTokenForLogging(accessToken), src, dst },
      'Moving Dropbox file'
    )

    const client = new DropboxClient({ accessToken })
    const result = await client.move(src, dst)

    res.json(result)
  } catch (err) {
    console.error('Dropbox move failed:', safeProviderError(err, req.body?.access_token || req.dropboxToken))

    if (err.statusCode === 401) return res.status(401).json({ error: 'Invalid token' })
    if (err.statusCode === 409)
      return res
        .status(409)
        .json({
          error: 'Conflict detected',
          message: safeProviderError(err, req.body?.access_token || req.dropboxToken)
        })

    res
      .status(err.statusCode || 500)
      .json({ error: safeProviderError(err, req.body?.access_token || req.dropboxToken) || 'Move failed' })
  }
})

// Start server
const PORT = process.env.DROPBOXINTERFACE_PORT || 4003

app.listen(PORT, () => {
  console.log(`DropboxInterface service running on port ${PORT}`)
})

export default app
