#!/usr/bin/env node

import express from 'express'
import Path from 'node:path'
import * as fileOperations from './fileOperations.mjs'
import * as syncService from './sync.mjs'
import { isSyncExcluded } from './fileUtils.mjs'
import { FileNotFoundError, DirectoryNotFoundError } from './errors.mjs'

const app = express()
app.use(express.json({ limit: '10mb' }))

// P0-1 / C6: Overleaf project ids are 12-char hex (mongo ObjectId)
function isValidProjectId(id) {
  return typeof id === 'string' && /^[0-9a-f]{12}$/i.test(id)
}

// Helper to get project directory
function getProjectDir(projectId) {
  const projectsRoot = process.env.DATAMANIPULATOR_PROJECTS_ROOT || '/projects'
  // Belt-and-braces (C6): even with a valid-format id, refuse any path that
  // resolves outside the projects root.
  const root = Path.resolve(projectsRoot)
  const resolved = Path.resolve(root, projectId)
  if (resolved !== root && !resolved.startsWith(root + Path.sep)) {
    const error = new Error('Invalid project_id')
    error.status = 400
    throw error
  }
  return resolved
}

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'datamanipulator' })
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

/**
 * GET /tree?project_id={id} - Get full project tree
 */
app.get('/tree', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }

    const projectDir = getProjectDir(projectId)
    const tree = await fileOperations.walkTree(projectDir)
    res.json(tree)
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError || err instanceof DirectoryNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /files?project_id={id}&path={relative_path} - List directory contents
 */
app.get('/files', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }

    const projectDir = getProjectDir(projectId)
    const tree = await fileOperations.walkTree(projectDir, req.query.path || '')
    
    // Filter to only the requested path's contents
    if (req.query.path) {
      const entries = tree.entries.filter(e => 
        e.relative_path === req.query.path ||
        e.relative_path.startsWith(req.query.path + '/')
      ).map(e => ({
        ...e,
        relative_path: e.relative_path.replace(req.query.path + '/', '')
      }))
      
      res.json({
        path: req.query.path,
        entries
      })
    } else {
      res.json(tree)
    }
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError || err instanceof DirectoryNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /file?project_id={id}&path={relative_path} - Get file content and metadata
 */
app.get('/file', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }
    if (!req.query.path) {
      return res.status(400).json({ error: 'Missing path parameter' })
    }

    const projectDir = getProjectDir(projectId)
    const fileData = await fileOperations.readFile(projectDir, req.query.path)
    
    // Return content as base64
    res.json({
      ...fileData,
      content_base64: fileData.content_base64 || ''
    })
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    if (err instanceof DirectoryNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /file?project_id={id}&path={relative_path} - Create/update file
 */
app.post('/file', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }
    if (!req.query.path) {
      return res.status(400).json({ error: 'Missing path parameter' })
    }

    const projectDir = getProjectDir(projectId)
    
    // DM-09: express.json() guarantees an object — the old string-body branch was unreachable
    let contentBuffer
    if (req.body.content_base64) {
      contentBuffer = Buffer.from(req.body.content_base64, 'base64')
    } else {
      return res.status(400).json({ error: 'Missing content in request body' })
    }

    const fileData = await fileOperations.writeFile(projectDir, req.query.path, contentBuffer)
    
    // Return metadata without the full buffer
    res.json({
      ...fileData,
      content_base64: ''
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * DELETE /file?project_id={id}&path={relative_path} - Delete file
 */
app.delete('/file', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }
    if (!req.query.path) {
      return res.status(400).json({ error: 'Missing path parameter' })
    }

    const projectDir = getProjectDir(projectId)
    await fileOperations.deletePath(projectDir, req.query.path)
    
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /pull?project_id={id} - Pull files from remote to local
 */
app.post('/pull', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }

    const projectDir = getProjectDir(projectId)
    // D2: never apply sync-excluded entries (LaTeX transients, hidden) from
    // a remote listing to the local project.
    const remoteFiles = (req.body.remote_files || []).filter(f => !isSyncExcluded(f.relative_path))
    const result = await syncService.pullFiles(projectDir, remoteFiles, {
      confirm_remote_deletions: req.body.confirm_remote_deletions === true,
      deleted_paths: Array.isArray(req.body.deleted_paths) ? req.body.deleted_paths.filter(p => !isSyncExcluded(p)) : undefined,
      // RF.7: /pull pulls ONE known project folder — an empty folder is
      // legitimate here, so the ARC-06 empty-listing throw is opted out.
      // (The strict guard is kept for every other caller; default false.)
      allowEmptyRemote: true
    })

    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /push?project_id={id} - Push files from local to remote
 *
 * HONEST LIMITATION (DM-01): this is a local-file-system service and has no
 * remote transport, so it cannot actually upload files. Instead of reporting
 * a fake success (counting files it merely read), it returns 501 with a
 * manifest of the local files that SHOULD be uploaded, for the caller to
 * transfer.
 */
app.post('/push', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }

    const projectDir = getProjectDir(projectId)
    const localTree = await fileOperations.walkTree(projectDir)
    const remoteFiles = req.body.remote_files || []
    const remotePaths = new Set(remoteFiles.map(f => f.relative_path))
    const toUpload = localTree.entries.filter(e => !remotePaths.has(e.relative_path))

    return res.status(501).json({
      error: 'datamanipulator is a local-filesystem service and has no remote transport; push (upload) is not implemented',
      to_upload_count: toUpload.length,
      to_upload_paths: toUpload.map(e => e.relative_path)
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /compare - Compare two trees and identify differences
 */
app.post('/compare', async (req, res) => {
  try {
    if (!req.body.left_tree || !req.body.right_tree) {
      return res.status(400).json({ error: 'Missing left_tree or right_tree' })
    }

    const comparison = syncService.compareTrees(req.body.left_tree, req.body.right_tree)
    
    res.json(comparison)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /sync/full?project_id={id} - Full sync with conflict detection
 */
app.post('/sync/full', async (req, res) => {
  try {
    const projectId = req.query.project_id
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project_id format' })
    }

    const projectDir = getProjectDir(projectId)
    // D2: exclude sync-excluded entries from the remote side of the sync.
    const remoteFiles = (req.body.remote_files || []).filter(f => !isSyncExcluded(f.relative_path))
    const result = await syncService.fullSync(projectDir, remoteFiles)

    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Start server
const PORT = process.env.DATAMANIPULATOR_PORT || 4001

app.listen(PORT, () => {
  console.log(`DataManipulator service running on port ${PORT}`)
})

export default app
