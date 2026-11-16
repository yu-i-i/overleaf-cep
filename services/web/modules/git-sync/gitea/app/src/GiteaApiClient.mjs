import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import {
  fetchJson,
  fetchNothing,
  fetchStream,
  RequestFailedError,
} from '@overleaf/fetch-utils'

import {
  InvalidTokenError,
  NotFoundError,
  GitConflictError,
  RateLimitError,
  ProviderRequestError,
  PermissionDeniedError,
  AlreadyExistsError,
} from '../../../common/app/src/GitSyncErrors.mjs'

const REQUEST_TIMEOUT_MS = 60_000
const REQUEST_LONG_TIMEOUT_MS = 600_000
const MAX_PER_PAGE = 50
const MAX_TREE_PER_PAGE = 1000
const MERGE_RETRY_INTERVAL_MS = 1500

const giteaUrl = Settings.giteaSync.url
const apiBase = `${giteaUrl}/api/v1`
const providerName = Settings.giteaSync.brand === 'forgejo' ? 'Forgejo' : 'Gitea'
const mergeRetryAttempts = Settings.giteaSync.mergeRetryAttempts
const maxConcurrency = Settings.giteaSync.apiMaxConcurrency

const syncContext = new AsyncLocalStorage()

function headers(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Overleaf-CEP-Gitea-Sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function repoPath(fullName) {
  const parts = fullName.split('/')
  if (parts.length !== 2 || parts.some(part => !part)) throw new Error(`Invalid ${providerName} repository name`)
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`
}

function encodeFilePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function normalizeError(err, operation) {
  logger.error({ err, operation }, 'Gitea API request failed')
  if (err.name === 'AbortError' || err.name === 'TimeoutError') {
    throw new ProviderRequestError(`${providerName} request timed out`, { status: 504 }, err)
  }
  if (!(err instanceof RequestFailedError)) {
    throw new ProviderRequestError(`${providerName} request failed`, { status: 500 }, err)
  }
  const status = err.response?.status || 500
  let body = err.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = null }
  }
  if (
    operation === 'refreshToken' && [400, 401].includes(status) &&
    (['invalid_grant', 'invalid_token'].includes(body?.error) ||
      (body?.error === 'unauthorized_client' &&
        body.error_description === 'token was already used'))
  ) {
    throw new InvalidTokenError(`${providerName} refresh token expired or revoked`, { status: 401 }, err)
  }
  if (status === 401) throw new InvalidTokenError('Invalid token', { status }, err)
  if (status === 404) throw new NotFoundError('Not found', { status }, err)
  if (status === 409) {
    if (operation === 'createRepo') throw new AlreadyExistsError('Repository already exists', { status }, err)
    throw new GitConflictError()
  }
  if (status === 429 || (status === 403 && err.response?.headers.get('retry-after') != null)) {
    throw new RateLimitError('Git provider rate limit reached. Wait before syncing again.', { status: 429 }, err)
  }
  if (status === 403) throw new PermissionDeniedError('Permission denied', { status }, err)

  if (status === 422 && operation === 'createRepo' &&
    typeof body?.message === 'string' &&
    /\b(name|pattern|reserved)\b/i.test(body.message)
  ) {
    throw new ProviderRequestError(`Invalid ${providerName} repository name`,
      { status: 400, key: 'github_sync_invalid_repository_name' }, err)
  }

  throw new ProviderRequestError(`${providerName} request failed`, { status }, err)
}

function get(path, token, operation, timeout = REQUEST_TIMEOUT_MS) {
  return request(path, token, 'GET', undefined, operation, timeout)
}

function request(path, token, method, json, operation, timeout = REQUEST_TIMEOUT_MS) {
  return fetchJson(`${apiBase}${path}`, {
    method, headers: headers(token), json, signal: AbortSignal.timeout(timeout),
  }).catch(err => normalizeError(err, operation))
}

function remove(path, token, operation) {
  return fetchNothing(`${apiBase}${path}`, {
    method: 'DELETE', headers: headers(token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(err => normalizeError(err, operation))
}

async function getPages(path, token, operation) {
  const all = []
  for (let page = 1; ; page++) {
    const separator = path.includes('?') ? '&' : '?'
    const values = await get(`${path}${separator}page=${page}&limit=${MAX_PER_PAGE}`, token, operation)
    if (!Array.isArray(values)) throw new ProviderRequestError(`Unexpected ${providerName} pagination response`, { status: 502 })
    all.push(...values)
    if (values.length < MAX_PER_PAGE) return all
  }
}

function getOAuth2Url() {
  const authUrl = new URL(`${giteaUrl}/login/oauth/authorize`)
  authUrl.searchParams.set('client_id', Settings.giteaSync.clientID)
  authUrl.searchParams.set('redirect_uri', Settings.giteaSync.callbackURL)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'write:user write:repository write:organization')
  return authUrl
}

function tokenTimestamp(result) {
  return Math.floor(Date.now() / 1000) + Math.max(1, Number(result.expires_in) - 300)
}

function toCredentials(response) {
  return {
    token: response.access_token,
    refresh_token: response.refresh_token,
    refresh_timestamp: tokenTimestamp(response),
  }
}

function exchangeCodeForToken(code) {
  return fetchJson(`${giteaUrl}/login/oauth/access_token`, {
    method: 'POST', headers: headers(),
    json: {
      client_id: Settings.giteaSync.clientID,
      client_secret: Settings.giteaSync.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: Settings.giteaSync.callbackURL,
      code,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(toCredentials)
    .catch(err => normalizeError(err, 'exchangeCodeForToken'))
}

function refreshToken(refreshToken) {
  return fetchJson(`${giteaUrl}/login/oauth/access_token`, {
    method: 'POST', headers: headers(),
    json: {
      client_id: Settings.giteaSync.clientID,
      client_secret: Settings.giteaSync.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(toCredentials)
    .catch(err => normalizeError(err, 'refreshToken'))
}

// Gitea does not advertise an OAuth token-revocation endpoint. Unlink removes
// the encrypted token in Overleaf; users can revoke authorization in Gitea.
async function revokeToken() {}

function getUser(token) {
  return get('/user', token, 'getUser').then(({ id, login, full_name }) => ({ id, login, name: full_name }))
}

async function getUserAndOrgs(token) {
  const [user, orgs] = await Promise.all([
    getUser(token), getPages('/user/orgs', token, 'getUserAndOrgs'),
  ])
  return { user: user.login, orgs: orgs.map(org => org.username || org.name) }
}

async function getPushPermission(token, fullName, branchName) {
  const repo = await get(`/repos/${repoPath(fullName)}`, token, 'getPushPermission')
  if (repo.object_format_name === 'sha256') {
    throw new ProviderRequestError(`${providerName} SHA-256 repositories are not supported`, { status: 422 })
  }
  if (repo.permissions?.push !== true || !(branchName || repo.default_branch)) return false
  const branch = await get(`/repos/${repoPath(fullName)}/branches/${encodeURIComponent(branchName || repo.default_branch)}`,
    token, 'getPushPermission:branch')
  return branch.user_can_push === true
}

function createRepo(token, { name, description, isPublic, org, branchName }) {
  const endpoint = org ? `/orgs/${encodeURIComponent(org)}/repos` : '/user/repos'
  return request(endpoint, token, 'POST', {
    name, description, private: !isPublic, auto_init: false, object_format_name: 'sha1', default_branch: branchName,
  }, 'createRepo', REQUEST_LONG_TIMEOUT_MS).then(repo => ({ fullName: repo.full_name }))
}

async function listUserRepos(token) {
  const user = await getUser(token)
  const repos = []
  for (let page = 1; ; page++) {
    const result = await get(`/repos/search?uid=${user.id}&exclusive=false&private=true&page=${page}&limit=${MAX_PER_PAGE}`,
      token, 'listUserRepos')
    if (!Array.isArray(result.data)) throw new ProviderRequestError(`Invalid ${providerName} repository search response`, { status: 502 })
    repos.push(...result.data)
    if (result.data.length < MAX_PER_PAGE || (result.total_count != null && repos.length >= result.total_count)) break
  }
  return repos.filter(repo => !repo.empty && !repo.archived && repo.object_format_name !== 'sha256').map(repo => ({
    name: repo.name,
    fullName: repo.full_name,
    defaultBranchName: repo.default_branch,
  }))
}

async function listRepoBranches(token, repoFullName) {
  const branches = await getPages(`/repos/${repoPath(repoFullName)}/branches`, token, 'listRepoBranches')
  return branches.map(branch => branch.name)
}

function session() {
  const context = syncContext.getStore()
  if (!context) throw new Error(`${providerName} commit creation requires a sync session`)
  return context
}

async function withTemporaryBranches(callback) {
  return syncContext.run({ blobs: new Map(), branches: [] }, async () => {
    try {
      return await callback()
    } finally {
      const { branches } = session()
      for (const { token, fullName, name } of branches.reverse()) {
        try {
          await deleteBranch(token, fullName, name)
        } catch (err) {
          logger.warn({ err, fullName, name }, 'Failed to clean up Gitea temporary branch')
        }
      }
    }
  })
}

// Unlike GitHub, Gitea cannot POST loose Git blobs, trees, or commits.
// Stage blob data in the per-sync context, then use Gitea's atomic multi-file
// commit API on a temporary branch. All branches are cleaned up at sync end.
async function uploadBlob(token, fullName, base64) {
  const bytes = Buffer.isBuffer(base64) ? base64 : Buffer.from(base64, 'base64')
  const sha = crypto.createHash('sha1')
    .update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  session().blobs.set(sha, bytes.toString('base64'))
  return sha
}

function createTree(token, fullName, entries) {
  return { entries }
}

async function listBlobsAtCommit(token, fullName, commit) {
  const entries = []
  for (let page = 1; ; page++) {
    const data = await get(`/repos/${repoPath(fullName)}/git/trees/${encodeURIComponent(commit)}?recursive=true&page=${page}&per_page=${MAX_TREE_PER_PAGE}`,
      token, 'listBlobsAtCommit', REQUEST_LONG_TIMEOUT_MS)
    if (!Array.isArray(data.tree) || (data.truncated && data.tree.length === 0)) {
      throw new ProviderRequestError(`Invalid ${providerName} tree page`, { status: 502 })
    }
    entries.push(...data.tree.filter(entry => entry.type === 'blob').map(entry => ({
      path: entry.path, sha: entry.sha, mode: entry.mode,
    })))
    if (!data.truncated) return entries
  }
}

async function getBlobBase64(token, fullName, sha) {
  const blob = await get(`/repos/${repoPath(fullName)}/git/blobs/${sha}`,
    token, 'getBlob', REQUEST_LONG_TIMEOUT_MS)
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new ProviderRequestError(`Unsupported ${providerName} blob encoding`, { status: 502 })
  return blob.content.replace(/\s/g, '')
}

async function createCommit(token, fullName, { tree, message, parents = [], initial = false, branch }) {
  if (initial && parents.length) throw new Error(`Initial ${providerName} commit must have no parents`)
  if (!initial && !parents[0]) throw new Error(`${providerName} commit requires a parent commit`)
  const parentCommit = initial ? null : parents[0]
  const paths = initial ? [] : await listBlobsAtCommit(token, fullName, parentCommit)
  const existing = new Map(paths.map(({ path, sha }) => [path, sha]))
  const files = []
  for (const entry of tree.entries) {
    const oldSha = existing.get(entry.path)
    if (!entry.sha) {
      if (oldSha) files.push({ operation: 'delete', path: entry.path, sha: oldSha })
    } else if (entry.sha !== oldSha) {
      const content = session().blobs.get(entry.sha) ?? await getBlobBase64(token, fullName, entry.sha)
      files.push({ operation: oldSha ? 'update' : 'create', path: entry.path,
        ...(oldSha ? { sha: oldSha } : {}), content })
    }
  }
  if (files.length === 0) {
    if (initial) throw new ProviderRequestError(`Cannot export an empty project to ${providerName}`, { status: 422 })
    return parentCommit
  }

  if (initial && !branch) throw new Error(`Initial ${providerName} commit requires a branch`)
  const commitBranch = branch || `overleaf-write-${crypto.randomUUID()}`
  if (!initial && branch) {
    if (await getBranchHead(token, fullName, branch) !== parentCommit) throw new GitConflictError()
  } else if (!initial) {
    await createBranch(token, fullName, commitBranch, parentCommit)
    session().branches.push({ token, fullName, name: commitBranch })
  }

  const result = await request(`/repos/${repoPath(fullName)}/contents`, token, 'POST', {
    branch: commitBranch, message, files,
  }, 'createCommit', REQUEST_LONG_TIMEOUT_MS)
  if (!result.commit?.sha) throw new ProviderRequestError(`${providerName} commit SHA missing`, { status: 502 })
  return result.commit.sha
}

function getBlobStream(token, fullName, ref, path) {
  return fetchStream(`${apiBase}/repos/${repoPath(fullName)}/raw/${encodeFilePath(path)}?ref=${encodeURIComponent(ref)}`, {
    headers: headers(token), signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }).catch(err => normalizeError(err, 'getBlobStream'))
}

function getBranchHead(token, fullName, branch) {
  return get(`/repos/${repoPath(fullName)}/branches/${encodeURIComponent(branch)}`, token, 'getBranchHead')
    .then(result => result.commit.id || result.commit.sha)
}

function createBranch(token, fullName, branch, sha) {
  return request(`/repos/${repoPath(fullName)}/branches`, token, 'POST', {
    new_branch_name: branch, old_ref_name: sha,
  }, 'createBranch')
}

function deleteBranch(token, fullName, branch) {
  return remove(`/repos/${repoPath(fullName)}/branches/${encodeURIComponent(branch)}`, token, 'deleteBranch')
}

function isPendingMerge(err) {
  if (!(err instanceof RequestFailedError) || err.response?.status !== 405) return false
  const message = typeof err.body === 'string' ? err.body : err.body?.message
  return typeof message === 'string' && /please try again later/i.test(message)
}

async function mergeBranch(token, fullName, base, head, expectedSource, retry = false) {
  const repo = repoPath(fullName)
  const open = retry ? await getPages(`/repos/${repo}/pulls?state=open`, token, 'findOpenPull') : []
  const existing = open.find(pull => pull.head?.ref === head && pull.base?.ref === base &&
    pull.head?.repo?.full_name === fullName && pull.base?.repo?.full_name === fullName)
  const pr = existing || await request(`/repos/${repo}/pulls`, token, 'POST', {
    base, head, title: 'Merge changes from Overleaf',
  }, 'createMergeRequest', REQUEST_LONG_TIMEOUT_MS)
  const headCommit = expectedSource ?? await getBranchHead(token, fullName, head)
  for (let attempt = 0; attempt < mergeRetryAttempts; attempt++) {
    try {
      await fetchNothing(`${apiBase}/repos/${repo}/pulls/${pr.number}/merge`, {
        method: 'POST', headers: headers(token),
        json: { do: 'merge', head_commit_id: headCommit },
        signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
      })
      const mergedHead = await getBranchHead(token, fullName, base)
      await requireSourceAncestry(token, fullName, headCommit, mergedHead)
      return mergedHead
    } catch (err) {
      if (isPendingMerge(err)) {
        if (attempt < mergeRetryAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, MERGE_RETRY_INTERVAL_MS))
          continue
        }
        const status = await get(`/repos/${repo}/pulls/${pr.number}`, token, 'mergeBranch:status')
        if (status.merged) {
          const mergedHead = await getBranchHead(token, fullName, base)
          await requireSourceAncestry(token, fullName, headCommit, mergedHead)
          return mergedHead
        }
        if (status.mergeable === false) {
          throw new GitConflictError()
        }
        // A delayed mergeability check is not proof of a content conflict.
        throw new ProviderRequestError(`${providerName} mergeability could not be determined (pull request #${pr.number} remains open)`, { status: 504 }, err)
      }
      if (err instanceof RequestFailedError && err.response?.status === 409) {
        throw new GitConflictError()
      }
      if (err instanceof ProviderRequestError) throw err
      normalizeError(err, 'mergeBranch')
    }
  }
}

async function compareCommitsFull(token, fullName, from, to) {
  const path = `/repos/${repoPath(fullName)}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`
  return get(path, token, 'compareCommits', REQUEST_LONG_TIMEOUT_MS)
}

async function isAncestor(token, fullName, ancestor, descendant) {
  try {
    if (ancestor === descendant) return true
    // The reverse comparison lists commits reachable from the proposed ancestor
    // which are absent from the descendant.
    const comparison = await compareCommitsFull(token, fullName, descendant, ancestor)
    if (!Number.isSafeInteger(comparison.total_commits) || comparison.total_commits < 0) {
      throw new ProviderRequestError(`${providerName} comparison commit count missing`, { status: 502 })
    }
    return comparison.total_commits === 0
  } catch (err) {
    if (err instanceof NotFoundError) return false
    throw err
  }
}

async function requireSourceAncestry(token, fullName, source, target) {
  if (!await isAncestor(token, fullName, source, target)) {
    throw new ProviderRequestError(
      'Synchronization requires merge commits that preserve source history.',
      { status: 409 }
    )
  }
}

async function listNewCommitsWithStatus(token, fullName, branch, from) {
  const to = await getBranchHead(token, fullName, branch)
  if (from === to) return { commits: [], diverged: false }
  try {
    const forward = await compareCommitsFull(token, fullName, from, to)
    const reverse = await compareCommitsFull(token, fullName, to, from)
    const diverged = Number(reverse.total_commits ?? reverse.commits?.length ?? 0) > 0
    return {
      diverged,
      commits: (forward.commits || []).map(commit => ({
        sha: commit.sha,
        message: commit.commit?.message || '',
        author: {
          name: commit.commit?.author?.name || '',
          email: commit.commit?.author?.email || '',
          date: commit.commit?.author?.date || '',
        },
      })),
    }
  } catch (err) {
    if (err instanceof NotFoundError) return { commits: [], diverged: true }
    throw err
  }
}

function getRepoZipball(token, fullName, sha) {
  return fetchStream(`${apiBase}/repos/${repoPath(fullName)}/archive/${encodeURIComponent(sha)}.zip`, {
    headers: headers(token), signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }).catch(err => normalizeError(err, 'getRepoZipball'))
}

async function getFirstParent(token, repo, sha) {
  const result = await get(`/repos/${repoPath(repo)}/git/commits/${sha}`, token, 'getFirstParent')
  const parent = result.parents?.[0]?.sha
  if (!parent) throw new ProviderRequestError('Missing parent of prepared Git commit.', { status: 502 })
  return parent
}

async function getTreeIdentity(token, repo, commit) {
  // Compare root entries directly. Directory IDs cover their complete subtrees.
  const entries = []
  let truncated
  let page = 1
  do {
    const result = await get(`/repos/${repoPath(repo)}/git/trees/${encodeURIComponent(commit)}?page=${page++}&per_page=${MAX_TREE_PER_PAGE}`,
      token, 'getTreeIdentity', REQUEST_LONG_TIMEOUT_MS)
    if (!Array.isArray(result.tree) || (result.truncated && !result.tree.length) ||
        result.tree.some(entry => !entry.path || !entry.mode || !entry.type || !entry.sha)) {
      throw new ProviderRequestError('Incomplete repository tree.', { status: 502 })
    }
    entries.push(...result.tree.map(entry => JSON.stringify([entry.path, entry.mode, entry.type, entry.sha])))
    truncated = result.truncated
  } while (truncated)
  return JSON.stringify(entries.sort())
}

export default {
  getFirstParent,
  getTreeIdentity,
  providerName,
  createsEmptyRepo: true,
  maxConcurrency,
  withTemporaryBranches,
  getOAuth2Url,
  exchangeCodeForToken,
  refreshToken,
  revokeToken,
  getUser,
  getUserAndOrgs,
  getPushPermission,
  createRepo,
  listUserRepos,
  listRepoBranches,
  uploadBlob,
  getBlobStream,
  createTree,
  createCommit,
  listBlobsAtCommit,
  listNewCommitsWithStatus,
  getBranchHead,
  createBranch,
  deleteBranch,
  isAncestor,
  mergeBranch,
  getRepoZipball,
}
