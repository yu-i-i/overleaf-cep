#!/usr/bin/env node

import express from 'express'
import logger from '@overleaf/logger'
import * as git from 'isomorphic-git'
import fs from 'fs'
import os from 'node:os'
import Path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

const app = express()
// GHI-07: no wildcard CORS — this is a process-to-process service;
// browsers never call it directly.
app.use(express.json({ limit: '10mb' }))

// GHI-05: bound concurrent operations (and their 10-min lifetimes)
const MAX_OPS = Math.max(1, Number.parseInt(process.env.GITHUBINTERFACE_MAX_OPS || '', 10) || 8)
const MAX_BUFFER_BYTES = (Math.max(1, Number.parseInt(process.env.GITHUBINTERFACE_MAX_BUFFER_MB || '', 10) || 64)) * 1024 * 1024
let inFlight = 0
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  inFlight++
  if (inFlight > MAX_OPS) {
    inFlight--
    return res.status(503).json({ error: 'service busy; try again shortly' })
  }
  res.once('close', () => {
    inFlight--
  })
  next()
})

// GHI-02: confine all filesystem work to a service-owned work root so client-
// supplied `dir`/`target_dir` cannot point at arbitrary container paths.
const WORK_ROOT = Path.resolve(
  process.env.GITHUBINTERFACE_WORKDIR_ROOT || Path.join(os.tmpdir(), 'ghif')
)
try {
  fs.mkdirSync(WORK_ROOT, { recursive: true, mode: 0o700 })
} catch (err) {
  logger.warn({ err, WORK_ROOT }, 'could not pre-create githubinterface work root')
}
function resolveWorkDir(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    const error = new Error('dir must be an absolute path within the service work root')
    error.status = 400
    throw error
  }
  const resolved = Path.resolve(value)
  if (resolved !== WORK_ROOT && !resolved.startsWith(WORK_ROOT + Path.sep)) {
    const error = new Error('dir is outside the allowed githubinterface work directory')
    error.status = 400
    throw error
  }
  return resolved
}

// GHI-03: only plain http(s) git servers (no file://, gopher:// etc.)
function assertGitServerUrl(serverUrl) {
  if (typeof serverUrl !== 'string') return null
  let parsed
  try {
    parsed = new URL(serverUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return serverUrl
}
function validateGitServerUrl(serverUrl) {
  if (assertGitServerUrl(serverUrl)) return
  const error = new Error('server_url must be an http(s) git server URL')
  error.status = 400
  throw error
}

// P0-4 / C5: final repository URLs must be plain http(s) with a hostname
function isAllowedServerUrl(raw) {
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''
  } catch {
    return false
  }
}

// P0-4: scrub a client token out of an error body/truncated to 500 chars
function scrubDetail(text, secret) {
  let detail = typeof text === 'string' ? text : ''
  if (secret) detail = detail.split(String(secret)).join('')
  return detail.slice(0, 500)
}

/**
 * Helper to extract credentials from request
 */
function getCredentials(req) {
  const { server_url, username, token, password } = req.body || {}
  
  const authPassword = token || password
  
  return {
    serverUrl: server_url?.replace(/\/$/, ''),
    username,
    password: authPassword
  }
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

/**
 * Run a git CLI command with optional credentials.
 * Credentials are provided via a temporary GIT_ASKPASS script so they never
 * appear in argv or the remote URL.
 */
async function runGit(args, { username, password, cwd } = {}) {
  // F2.3 / H9: random suffix (not Date.now()) so two concurrent git ops in the
  // same millisecond can never share/overwrite each other's credentials file.
  const askpass = Path.join(os.tmpdir(), `ghif_askpass_${process.pid}_${crypto.randomBytes(8).toString('hex')}.sh`)
  const user = username || 'git'
  const script = [
    '#!/bin/sh',
    'case "$1" in',
    `  Username*) printf '%s\n' ${shellQuote(user)} ;;`,
    `  Passw*) printf '%s\n' ${shellQuote(password || '')} ;;`,
    "  *) printf '' ;;",
    'esac',
    ''
  ].join('\n')
  try {
    fs.writeFileSync(askpass, script, { mode: 0o700 })
    return await pExecFile('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: cwd || os.tmpdir(),
      env: {
        ...process.env,
        GIT_ASKPASS: askpass,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never'
      },
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: 10 * 60 * 1000
    })
  } finally {
    fs.rmSync(askpass, { force: true })
  }
}

/**
 * POST /check - Verify credentials work with the Git server
 */
app.post('/check', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)

    if (!serverUrl || !password) {
      return res.status(400).json({
        error: 'Missing required fields: server_url and token'
      })
    }
    validateGitServerUrl(serverUrl)

    // 1) Try the provider REST user endpoint - validates the PAT and
    //    works even when serverUrl is a base URL (e.g. https://github.com)
    try {
      const base = await detectApiBase(serverUrl)
      const r = await fetch(`${base}/user`, { headers: apiHeaders(password, base) })
      if (r.status === 200) {
        const json = (await r.json().catch(() => ({}))) || {}
        logger.debug({ serverUrl }, 'Git server check completed via API')
        return res.json({
          status: 'ok',
          message: 'Connection successful',
          login: json.login || json.username || ''
        })
      }
      if (r.status === 401 || r.status === 403) {
        const text = await r.text()
        return res.status(401).json({
          status: 'error',
          error: 'Token rejected by server',
          detail: scrubDetail(text, password)
        })
      }
      await r.arrayBuffer()
    } catch {
      // API not reachable - fall through to git-protocol check
    }

    // 2) Fall back to the git protocol (works for any git server)
    try {
      await runGit(['ls-remote', '--exit-code', serverUrl], { username, password })
      logger.debug({ serverUrl }, 'Git server check completed')
      return res.json({ status: 'ok', message: 'Connection successful' })
    } catch (err) {
      logger.debug({ serverUrl, message: err.message }, 'git protocol check failed')
      return res.status(401).json({
        status: 'error',
        error: 'Token rejected by server (git protocol fallback)'
      })
    }
  } catch (err) {
    res.status(err?.status || 500).json({ error: err.message || 'Connection failed' })
  }
})

/**
 * POST /clone - Clone a repository
 */
app.post('/clone', async (req, res) => {
  const { repo_url, ref = 'HEAD', target_dir } = req.body || {}
  try {
    const { serverUrl, username, password } = getCredentials(req)

    if (!repo_url || !target_dir) {
      return res.status(400).json({ 
        error: 'Missing required fields: repo_url and target_dir' 
      })
    }

    const target = resolveWorkDir(target_dir)
    if (serverUrl) validateGitServerUrl(serverUrl)

    // P0-4 / C5: validate the FINAL URL that will be cloned (not just the
    // optional server_url) — blocks file://, gopher://, internal hosts, etc.
    if (!isAllowedServerUrl(repo_url)) {
      return res.status(400).json({ error: 'repo_url must be an http(s) URL' })
    }
    if (serverUrl) {
      const expectedHost = new URL(serverUrl).hostname.toLowerCase()
      const finalHost = new URL(repo_url).hostname.toLowerCase()
      if (finalHost !== expectedHost) {
        return res.status(400).json({ error: 'repo_url host must match server_url' })
      }
    } else if (new URL(repo_url).protocol !== 'https:') {
      return res.status(400).json({ error: 'insecure repo_url without server_url' })
    }

    const cloneArgs = ['clone', '--progress']
    if (ref && ref !== 'HEAD') cloneArgs.push(`--branch=${ref}`)
    cloneArgs.push(repo_url, target)
    await runGit(cloneArgs, { username, password })
    
    logger.debug({ 
      repo_url, 
      target_dir, 
      ref 
    }, 'Repository cloned successfully')
    
    res.json({ success: true, message: 'Repository cloned successfully' })
  } catch (err) {
    logger.error({ err, repo_url, ref, target_dir }, 'Git clone failed')
    res.status(err?.status || 500).json({ error: err.message || 'Clone failed' })
  }
})

/**
 * POST /push - Push local commits to remote
 */
app.post('/push', async (req, res) => {
  const { dir, remote = 'origin', ref = 'HEAD' } = req.body || {}
  try {
    const { username, password } = getCredentials(req)

    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }
    // P0-4 / H14: only the default remote and plain refs (no force refspecs)
    if (remote !== 'origin') {
      return res.status(400).json({ error: 'only origin remote supported' })
    }
    if (ref && (/^-/.test(ref) || /[\s+:]/.test(ref))) {
      return res.status(400).json({ error: 'invalid ref' })
    }
    const workDir = resolveWorkDir(dir)

    await runGit(['push', remote, ref], { username, password, cwd: workDir })
    
    logger.debug({ 
      dir, 
      remote, 
      ref 
    }, 'Git push completed')
    
    res.json({ success: true, message: 'Push completed successfully' })
  } catch (err) {
    logger.error({ err, dir, remote, ref }, 'Git push failed')
    res.status(err?.status || 500).json({ error: err.message || 'Push failed' })
  }
})

/**
 * POST /pull - Pull from remote to local
 */
app.post('/pull', async (req, res) => {
  const { dir, remote = 'origin', ref = 'HEAD' } = req.body || {}
  try {
    const { username, password } = getCredentials(req)

    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }
    // P0-4 / H14: only the default remote and plain refs
    if (remote !== 'origin') {
      return res.status(400).json({ error: 'only origin remote supported' })
    }
    if (ref && (/^-/.test(ref) || /[\s+:]/.test(ref))) {
      return res.status(400).json({ error: 'invalid ref' })
    }
    const workDir = resolveWorkDir(dir)

    await runGit(['pull', remote, ref], { username, password, cwd: workDir })
    
    logger.debug({ 
      dir, 
      remote, 
      ref 
    }, 'Git pull completed')
    
    res.json({ success: true, message: 'Pull completed successfully' })
  } catch (err) {
    logger.error({ err, dir, remote, ref }, 'Git pull failed')
    res.status(err?.status || 500).json({ error: err.message || 'Pull failed' })
  }
})

/**
 * POST /commit - Create a new commit
 */
app.post('/commit', async (req, res) => {
  const { dir, files, message, author } = req.body || {}
  try {
    const { username } = getCredentials(req)

    if (!dir || !files || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: dir, files, and message' 
      })
    }
    const workDir = resolveWorkDir(dir)

    // GHI-06: content must already exist on disk (shared container fs);
    // /commit only stages + commits. Validate up front for a clear error.
    const filepaths = files.map(f => f?.path).filter(Boolean)
    const missing = filepaths.filter(p => !fs.existsSync(Path.join(workDir, p)))
    if (missing.length) {
      return res.status(400).json({
        error: 'files not found in dir (content must be written before /commit): ' +
          missing.slice(0, 10).join(', ')
      })
    }

    // GHI-06: isomorphic-git requires author AND committer with emails
    const authorName = (author && author.name) || username || 'Overleaf'
    const identity = {
      name: authorName,
      email: (author && author.email) || `${authorName.replace(/[^a-zA-Z0-9-]/g, '') || 'overleaf'}@localhost`
    }    // Add files to index
    await git.add({
      fs,
      dir: workDir,
      filepath: filepaths
    })
    
    // Get current HEAD (null on unborn-HEAD / empty repos → root commit)
    let head = null
    try {
      head = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' })
    } catch {
      head = null
    }
    
    // GHI-12: do NOT call git.writeTree here — in isomorphic-git v1, writeTree
    // REQUIRES an explicit tree object (tree={entries}); the bare call crashed
    // every /commit with MissingParameterError "'tree'", breaking git-sync
    // export for ALL providers. git.commit instead builds the tree from the
    // staged index (constructTree) when `tree` is omitted.
    // Create commit from the staged index (tree derived internally)
    const commitSha = await git.commit({
      fs,
      dir: workDir,
      message,
      author: identity,
      committer: identity,
      parents: head ? [head] : []
    })
    
    logger.debug({ 
      dir: workDir, 
      commitSha,
      fileCount: files.length 
    }, 'Git commit created')
    
    res.json({ success: true, commit_sha: commitSha })
  } catch (err) {
    logger.error({ err, dir, message, fileCount: files?.length || 0 }, 'Git commit failed')
    res.status(err?.status || 500).json({ error: err.message || 'Commit failed' })
  }
})

/**
 * GET /log - Get commit history
 */
app.get('/log', async (req, res) => {
  const { dir, ref = 'HEAD', limit = 50, page = 1 } = req.query
  try {
    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }
    const workDir = resolveWorkDir(dir)

    const commits = []
    let skipCount = (page - 1) * limit
    
    for await (const commit of git.log({
      fs,
      dir: workDir,
      ref,
      maxCount: limit + skipCount
    })) {
      if (skipCount > 0) {
        skipCount--
        continue
      }
      
      commits.push({
        sha: commit.oid,
        message: commit.commit.message,
        author: {
          name: commit.commit.author.name,
          email: commit.commit.author.email,
          date: new Date(commit.commit.author.timestamp * 1000).toISOString()
        },
        parents: commit.parents
      })
    }
    
    logger.debug({ 
      dir, 
      ref,
      page,
      limit,
      commitsCount: commits.length 
    }, 'Git log retrieved')
    
    res.json({
      commits,
      has_more: commits.length >= limit,
      current_page: page
    })
  } catch (err) {
    logger.error({ err, dir, ref }, 'Git log failed')
    res.status(err?.status || 500).json({ error: err.message || 'Log fetch failed' })
  }
})

/**
 * GET /status - Get git status
 */
app.get('/status', async (req, res) => {
  try {
    const { dir } = req.query
    
    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }
    const workDir = resolveWorkDir(dir)

    const statusMatrix = await git.statusMatrix({
      fs,
      dir: workDir
    })
    
    // Convert status matrix to human-readable format
    const uncommittedFiles = []
    for (const [filepath, [, stagedStatus, workingTreeStatus]] of statusMatrix.entries()) {
      if (stagedStatus !== 0 || workingTreeStatus !== 0) {
        let combinedStatus = ''
        if (workingTreeStatus === 1) combinedStatus += 'M' // modified
        else if (workingTreeStatus === 2) combinedStatus += '?' // untracked
        else if (workingTreeStatus === 3) combinedStatus += 'D' // deleted
        
        if (stagedStatus === 1) combinedStatus = combinedStatus.replace('M', 'A') // staged modified
        else if (stagedStatus === 2 && !combinedStatus.includes('?')) combinedStatus = 'A' // added
        else if (stagedStatus === 3) combinedStatus = 'D' // deleted
        
        uncommittedFiles.push({
          path: filepath,
          status: combinedStatus || '?'
        })
      }
    }
    
    logger.debug({ 
      dir, 
      uncommittedCount: uncommittedFiles.length 
    }, 'Git status retrieved')
    
    // Get current branch
    let currentBranch = '(unknown)'
    try {
      const headRef = await git.resolveRef({ fs, dir: workDir, ref: 'HEAD' })
      if (headRef.startsWith('refs/heads/')) {
        currentBranch = headRef.substring('refs/heads/'.length)
      }
    } catch {
      // Ignore - will use default
    }
    
    // H.4 (M12): report honest ahead/behind against the origin branch
    // (hardcoded 0 used to imply "fully in sync" without checking).
    // null = unknown (no origin/<branch> ref locally, e.g. before first pull).
    let ahead = null
    let behind = null
    if (currentBranch !== '(unknown)') {
      try {
        const { stdout } = await runGit(
          ['rev-list', '--left-right', '--count', `HEAD...origin/${currentBranch}`],
          { cwd: workDir }
        )
        const [a, b] = String(stdout).trim().split(/\s+/)
        ahead = Number.parseInt(a, 10) || 0
        behind = Number.parseInt(b, 10) || 0
      } catch {
        ahead = null
        behind = null
      }
    }

    res.json({
      branch: currentBranch,
      ahead,
      behind,
      uncommitted_files: uncommittedFiles
    })
  } catch (err) {
    logger.error({ err, dir: req.query.dir }, 'Git status failed')
    res.status(err?.status || 500).json({ error: err.message || 'Status fetch failed' })
  }
})


// ------------------------------------------------------------------
// Provider-agnostic REST helpers (GitHub / GitHub-Enterprise /
// GitLab / Gitea / Forgejo)
// ------------------------------------------------------------------

/**
 * Detect the REST API base for a given git server URL.
 * Returns e.g. https://api.github.com, {server}/api/v4 (GitLab),
 * {server}/api/v1 (Gitea/Forgejo), {server}/api/v3 (GHE).
 */
async function detectApiBase(serverUrl) {
  const u = String(serverUrl || '').replace(/\/+$/, '')
  let host = ''
  try {
    host = new URL(u).hostname.toLowerCase()
  } catch {
    // not a valid URL; fall through to probes
  }
  if (host.endsWith('github.com')) {
    return 'https://api.github.com'
  }
  // Probe in order of likelihood for self-hosted servers.
  // 401/403 means the endpoint exists but requires auth -> correct base.
  for (const suffix of ['api/v4', 'api/v1', 'api/v3']) {
    const base = `${u}/${suffix}`
    try {
      const r = await fetch(`${base}/user`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
      if (r.status === 200 || r.status === 401 || r.status === 403) {
        await r.arrayBuffer()
        return base
      }
    } catch {
      // unreachable, try next candidate
    }
  }
  return `${u}/api/v4`
}

function apiHeaders(token, base) {
  const family = base ? baseFamily(base) : 'github'
  const auth =
    family === 'gitea' || family === 'forgejo'
      ? { Authorization: `token ${token}` }
      : { Authorization: `Bearer ${token}` }
  if (family === 'gitlab') auth['PRIVATE-TOKEN'] = token
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? auth : {}),
  }
}

function baseFamily(base) {
  if (base.endsWith('/api/v4')) return 'gitlab'
  if (base.endsWith('/api/v3')) return 'github'
  return 'gitea'
}

/**
 * POST /orgs - list organizations the token belongs to
 */
app.post('/orgs', async (req, res) => {
  try {
    const { serverUrl, password: token } = getCredentials(req)
    if (!serverUrl || !token) {
      return res.status(400).json({ error: 'Missing server_url and token' })
    }
    validateGitServerUrl(serverUrl)
    const base = await detectApiBase(serverUrl)
    const family = baseFamily(base)
    const url = family === 'gitlab'
      ? `${base}/groups?membership=true&per_page=100`
      : `${base}/user/orgs?limit=100`
    const r = await fetch(url, { headers: apiHeaders(token, base) })
    if (!r.ok) {
      const text = await r.text()
      return res.status(r.status).json({ error: scrubDetail(text, token).slice(0, 500) || `HTTP ${r.status}` })
    }
    const json = await r.json()
    const orgs = (json || []).map(o => o.login).filter(Boolean)
    // Also report the authenticated user's login so the UI can label the
    // "personal account" owner option even when no username was stored.
    let user = ''
    try {
      const ur = await fetch(`${base}/user`, { headers: apiHeaders(token, base) })
      if (ur.ok) {
        const uj = await ur.json().catch(() => ({}))
        user = uj.login || uj.username || ''
      }
    } catch {
      user = ''
    }
    res.json({ orgs, user })
  } catch (err) {
    logger.error({ err }, 'orgs fetch failed')
    res.status(err?.status || 500).json({ error: err.message || 'Failed to list orgs' })
  }
})

/**
 * POST /create-repo - create a repository on the git server
 */
app.post('/create-repo', async (req, res) => {
  try {
    const { serverUrl, username, password: token } = getCredentials(req)
    const { name, description, is_public: isPublic, org } = req.body || {}
    if (!serverUrl || !token || !name) {
      return res.status(400).json({ error: 'Missing server_url, token or name' })
    }
    validateGitServerUrl(serverUrl)
    const base = await detectApiBase(serverUrl)
    const family = baseFamily(base)

    let url, body
    if (family === 'gitlab') {
      url = org ? `${base}/groups/${encodeURIComponent(org)}/projects` : `${base}/projects`
      body = {
        name,
        description,
        visibility: isPublic ? 'public' : 'private',
        initialize_with_readme: true
      }
    } else {
      url = org ? `${base}/orgs/${encodeURIComponent(org)}/repos` : `${base}/user/repos`
      body = {
        name,
        description,
        private: !isPublic,
        ...(family === 'github' ? { auto_init: true } : { auto_init: true })
      }
    }

    const r = await fetch(url, { method: 'POST', headers: apiHeaders(token, base), body: JSON.stringify(body) })
    const text = await r.text()
    if (!r.ok) {
      return res.status(r.status).json({ error: scrubDetail(text, token).slice(0, 500) || `HTTP ${r.status}` })
    }
    let json = {}
    try { json = JSON.parse(text) } catch { /* body not JSON; keep {} */ }

    if (family === 'gitlab') {
      return res.json({
        full_name: json.path_with_namespace || json.name,
        default_branch: json.default_branch || 'main'
      })
    }
    return res.json({
      full_name: json.full_name || `${org || username}/${name}`,
      default_branch: json.default_branch || 'main'
    })
  } catch (err) {
    logger.error({ err }, 'create-repo failed')
    res.status(err?.status || 500).json({ error: err.message || 'Failed to create repository' })
  }
})

/**
 * POST /list-repos - list repositories owned by the token
 */
app.post('/list-repos', async (req, res) => {
  try {
    const { serverUrl, username, password: token } = getCredentials(req)
    if (!serverUrl || !token) {
      return res.status(400).json({ error: 'Missing server_url or token' })
    }
    validateGitServerUrl(serverUrl)
    const base = await detectApiBase(serverUrl)
    const family = baseFamily(base)

    const url = family === 'gitlab'
      ? `${base}/projects?membership=true&per_page=100`
      : `${base}/user/repos?limit=100`

    const r = await fetch(url, { headers: apiHeaders(token, base) })
    if (!r.ok) {
      const text = await r.text()
      return res.status(r.status).json({ error: String(text).slice(0, 500) || `HTTP ${r.status}` })
    }
    // GHI-04: parse the body exactly once (previous code awaited r.json() twice)
    let json
    try {
      json = await r.json()
    } catch {
      return res.status(502).json({ error: 'invalid list-repos payload from git server' })
    }
    if (!Array.isArray(json)) {
      return res.status(502).json({ error: 'unexpected list-repos payload type' })
    }
    const repos = json.map(item => ({
      name: item.name,
      fullName: family === 'gitlab'
        ? (item.path_with_namespace || item.name)
        : (item.full_name || `${username}/${item.name}`),
      defaultBranchName: item.default_branch || 'main'
    }))
    res.json({ repos })
  } catch (err) {
    logger.error({ err }, 'list-repos failed')
    res.status(err?.status || 500).json({ error: err.message || 'Failed to list repositories' })
  }
})

/**
 * POST /can-push - verify the token can access the repository
 */
app.post('/can-push', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { repo } = req.body || {}
    if (!serverUrl || !repo) {
      return res.status(400).json({ error: 'Missing server_url or repo' })
    }
    validateGitServerUrl(serverUrl)
    const repoUrl = `${String(serverUrl).replace(/\/+$/, '')}/${repo}.git`
    await runGit(['ls-remote', '--exit-code', repoUrl], { username, password })
    return res.json({ can_push: true })
  } catch (err) {
    const status = /403|401|forbidden|unauthorized/i.test(String(err.message)) ? 403 : 404
    return res.status(status).json({ can_push: false, error: err.message })
  }
})

/**
 * POST /branch-head - resolve branch to commit sha
 */
app.post('/branch-head', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { repo, branch } = req.body || {}
    if (!serverUrl || !repo || !branch) {
      return res.status(400).json({ error: 'Missing server_url, repo or branch' })
    }
    validateGitServerUrl(serverUrl)
    const repoUrl = `${String(serverUrl).replace(/\/+$/, '')}/${repo}.git`
    const { stdout } = await runGit(['ls-remote', repoUrl, `refs/heads/${branch}`], { username, password })
    const line = stdout.split('\n').map(l => l.trim()).filter(Boolean)[0]
    if (!line) {
      return res.status(404).json({ error: `Branch ${branch} not found` })
    }
    const sha = line.split(/\s+/)[0]
    res.json({ sha })
  } catch (err) {
    logger.error({ err }, 'branch-head failed')
    res.status(err?.status || 500).json({ error: err.message || 'Failed to resolve branch' })
  }
})

/**
 * POST /commits - list commits on a branch newer than an optional
 * since-commit; reports divergence.
 */
app.post('/commits', async (req, res) => {
  const { serverUrl, username, password } = getCredentials(req)
  const { repo, branch, since, limit = 50 } = req.body || {}
  if (!serverUrl || !repo || !branch) {
    return res.status(400).json({ error: 'Missing server_url, repo or branch' })
  }
  validateGitServerUrl(serverUrl)
  const repoUrl = `${String(serverUrl).replace(/\/+$/, '')}/${repo}.git`
  // GHI-11: crypto-based dir name; GHI-10: shallow clone (fallback: full clone).
  // NOTE: shallow only when no `since` — with `since` the full history is
  // needed to locate the base commit (merge-overview divergence checks).
  const shallow = !since
  const dir = Path.join(WORK_ROOT, `commits_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`)
  try {
    try {
      await runGit(
        shallow
          ? ['clone', '--progress', '--depth', String(Number(limit) + 1), '--single-branch', '--branch', branch, repoUrl, dir]
          : ['clone', '--progress', '--branch', branch, repoUrl, dir],
        { username, password }
      )
    } catch {
      // shallow unsupported or depth exceeded → clean partial clone, retry full
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch { /* best effort cleanup */ }
      await runGit(['clone', '--progress', '--branch', branch, repoUrl, dir], { username, password })
    }
    // GHI-13: enumerate history with the git CLI (already used here for
    // clone/push). isomorphic-git v1's log() was unusable for both cases:
    //   - with a baseline it only supports `since` (a Date), not a SHA range,
    //     so `git.log({ from, to })` threw and the catch reported "diverged"
    //     even right after a clean export;
    //   - without one it still requires an `fs` argument.
    // A range that can't be resolved (baseline not an ancestor of HEAD:
    // force-push, branch rewrite) means genuinely diverged.
    // NOTE: %s (single-line subject) is used instead of %B so the output
    // stays one line per commit — %B bodies would split into bogus entries.
    const parseGitLog = (stdout) =>
      stdout
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [sha, name, email, date, , message] = line.split('\u001f')
          return {
            id: sha,
            author: { name: name || '', email: email || '', date: date || '' },
            commit: { date: date || '', message: message || '' },
          }
        })
    let log = []
    if (since) {
      try {
        const { stdout } = await runGit(
          ['log', '--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s', `${since}..HEAD`],
          { username, password, cwd: dir }
        )
        log = parseGitLog(stdout)
      } catch {
        // since-commit no longer in history (force push etc.) -> diverged
        return res.json({ commits: [], diverged: true })
      }
    } else {
      const { stdout } = await runGit(
        ['log', '--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s'],
        { username, password, cwd: dir }
      )
      log = parseGitLog(stdout)
    }
    const commits = log.slice(0, limit).map(c => ({
      sha: c.id,
      message: c.message || c.commit?.message || '',
      author: {
        name: c.author?.name || c.commit?.author?.name || '',
        email: c.author?.email || c.commit?.author?.email || '',
        date: c.commit?.date || c.date || ''
      }
    }))
    // GHI-14: success path is NEVER diverged — the UI shows the force-push
    // warning (github_repository_diverged) and the handler flips the project
    // state to mergeStatus='diverged' (detached merge path) based on this flag,
    // so it must be reserved for the catch case above (baseline not in
    // history). "Commits since the baseline" is the normal mergeable case.
    res.json({ commits, diverged: false })
  } catch (err) {
    logger.error({ err, repoUrl }, 'commits failed')
    res.status(err?.status || 500).json({ error: err.message || 'Failed to list commits' })
  } finally {
    if (fs.existsSync(dir)) {
      await new Promise(resolve => {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort cleanup */ }
        resolve()
      })
    }
  }
})

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'githubinterface' })
})

// GHI-01: service authentication — same pattern as webdavinterface /
// dropboxinterface / datamanipulator. Enforced only when SHARED_SERVICE_TOKEN
// is set; unset = degraded mode (warning), so the current compose deployment
// keeps working. /health stays open (registered above).
if (process.env.SHARED_SERVICE_TOKEN) {
  app.use((req, res, next) => {
    if (req.path === '/health') return next()
    const provided = req.header('x-service-token') ||
      String(req.header('authorization') || '').replace(/^bearer\s+/i, '').trim()
    const expTok = Buffer.from(process.env.SHARED_SERVICE_TOKEN)
    const gotTok = Buffer.from(String(provided))
    const sameTok = gotTok.length === expTok.length && crypto.timingSafeEqual(gotTok, expTok)
    if (provided && !sameTok) {
      return res.status(401).json({ error: 'invalid service token' })
    }
    if (!provided) {
      return res.status(401).json({ error: 'missing service token' })
    }
    next()
  })
  logger.info('githubinterface: SHARED_SERVICE_TOKEN auth enforced')
} else {
  logger.warn('githubinterface: SHARED_SERVICE_TOKEN not set — running UNAUTHENTICATED (degraded mode)')
}

// Start server when this is the main module (works in both CJS and ESM)
const isMain = import.meta.url.startsWith('file:');
if (isMain) {
  const PORT = process.env.GITHUBINTERFACE_PORT || 4013

  app.listen(PORT, () => {
    console.log(`GitHubInterface service running on port ${PORT}`)
  })
}

export default app
