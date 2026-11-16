import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import pLimit from 'p-limit'

import {
  fetchJson,
  fetchJsonWithResponse,
  fetchNothing,
  fetchStream,
  RequestFailedError,
} from '@overleaf/fetch-utils'

import {
  InvalidTokenError,
  ExpiredTokenError,
  NotFoundError,
  GitConflictError,
  RateLimitError,
  ProviderRequestError,
  PermissionDeniedError,
  AlreadyExistsError,
} from '../../../common/app/src/GitSyncErrors.mjs'

const REQUEST_TIMEOUT_MS = 60_000
const REQUEST_LONG_TIMEOUT_MS = 600_000
const MAX_PER_PAGE = 100

const gitlabUrl = Settings.gitlabSync.url
const apiBase = `${gitlabUrl}/api/v4`
const mergeRequestPollInterval = Settings.gitlabSync.mergeRequestPollInterval
const mergeRequestTimeout = Settings.gitlabSync.mergeRequestTimeout
const maxConcurrency = Settings.gitlabSync.apiMaxConcurrency

const mergeRequestPendingStates = new Set([
  'unchecked',
  'checking',
  'preparing',
  'approvals_syncing',
  'ci_still_running',
])

const mergeRequestBlockingStates = new Set([
  'conflict',
  'ci_must_pass',
  'commits_status',
  'discussions_not_resolved',
  'draft_status',
  'jira_association_missing',
  'merge_request_blocked',
  'merge_time',
  'need_rebase',
  'not_approved',
  'not_open',
  'requested_changes',
  'security_policy_pipeline_check',
  'security_policy_violations',
  'status_checks_must_pass',
  'locked_paths',
  'locked_lfs_files',
  'title_regex',
])

const syncContext = new AsyncLocalStorage()

function buildHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Overleaf-CEP-GitLab-Sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function encodePath(path) {
  return encodeURIComponent(path)
}

function projectPath(repoFullName) {
  return encodeURIComponent(repoFullName)
}

function isRateLimitError(response) {
  return response.headers.get('retry-after') != null
}

function isRepositoryAlreadyExistsError(err) {
  if (err.response?.status !== 400) {
    return false
  }

  let json_data = err.body
  if (typeof json_data === 'string') {
    try { json_data = JSON.parse(json_data) } catch { return false }
  }
  if (!json_data?.message || typeof json_data.message !== 'object') return false
  return Object.values(json_data.message).some(value => {
    if (Array.isArray(value)) {
      return value.includes("has already been taken");
    }
    return value === "has already been taken";
  });
}

function normalizeGitLabError(err, operation) {
  const body = err.body || ''
  logger.error({ operation, err, body }, 'GitLab API request failed')

  if ((err.name === 'AbortError' || err.name === 'TimeoutError')) {
    throw new ProviderRequestError('GitLab request timed out', { status: 504 }, err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new ProviderRequestError('Something wrong with GitLab request', { status: 500 }, err)
  }

  const status = err.response?.status || 500
  let json_body = err.body
  if (typeof json_body === 'string') {
    try { json_body = JSON.parse(json_body) } catch { json_body = null }
  }

  if (operation === 'refreshToken' && [400, 401].includes(status) &&
      ['invalid_grant', 'invalid_token'].includes(json_body?.error)) {
    throw new InvalidTokenError('GitLab refresh token expired or revoked', { status: 401 }, err)
  }
  if (status === 401) {
    if (json_body && typeof json_body.error === 'string' && json_body.error.toLowerCase() === 'invalid_token') {
      throw new ExpiredTokenError('Token expired', { status }, err)
    }

    throw new InvalidTokenError('Invalid token', { status }, err)
  }

  if (status === 404) {
    throw new NotFoundError('Not found', { status }, err)
  }

  if (status === 403 || status === 429) {
    if (status === 429 || isRateLimitError(err.response)) throw new RateLimitError('Git provider rate limit reached. Wait before syncing again.', { status: 429 }, err)
    throw new PermissionDeniedError('Permission denied', { status: 403 }, err)
  }

  if (status === 400 && operation === 'createRepo') {
    if (isRepositoryAlreadyExistsError(err)) {
      throw new AlreadyExistsError('Repository already exists', { status }, err)
    }
    const validation = json_body?.message
    if ((typeof validation === 'object' && validation && ('name' in validation || 'path' in validation)) ||
        (typeof validation === 'string' && /\b(name|path)\b/i.test(validation))) {
      throw new ProviderRequestError('Invalid GitLab repository name', { status, key: 'github_sync_invalid_repository_name' }, err)
    }
  }

  throw new ProviderRequestError('GitLab request failed', { status }, err)
}

// wrappers
function fetchGitLabJson(url, options, operation) {
  return fetchJson(url, options).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

function fetchGitLabJsonWithResponse(url, options, operation) {
  return fetchJsonWithResponse(url, options).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

function fetchGitLabNothing(url, options, operation) {
  return fetchNothing(url, options).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

function fetchGitLabStream(url, options, operation) {
  return fetchStream(url, options).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

async function fetchAllPages(url, options, operation) {
  let page = 1
  let all = []

  while (true) {
    const pageUrl = new URL(url.toString())
    pageUrl.searchParams.set('page', page.toString())

    const { json, response } = await fetchGitLabJsonWithResponse(pageUrl.toString(), options, operation)
    if (!Array.isArray(json)) throw new ProviderRequestError('Invalid GitLab list response', { status: 502 })
    all = all.concat(json)

    const link = response.headers.get('link') || ''
    if (!link.includes('rel="next"')) break
    page++
  }

  return all
}

function getTokenRefreshTimestamp(token, safetyMarginInSec = 300) {
  return token.created_at + token.expires_in - safetyMarginInSec;
}


async function compareCommitsFull(token, repoFullName, from, to) {
  const url = new URL(`${apiBase}/projects/${projectPath(repoFullName)}/repository/compare`)
  url.searchParams.set('from', from)
  url.searchParams.set('to', to)

  return await fetchGitLabJson(url.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'compareCommitsFull')
}


// ---------------------- exports ------------------------------- //

// OAuth
function getOAuth2Url() {
  const oAuthUrl = new URL(`${gitlabUrl}/oauth/authorize`)
  oAuthUrl.searchParams.append('client_id', Settings.gitlabSync.clientID)
  oAuthUrl.searchParams.append('redirect_uri', Settings.gitlabSync.callbackURL)
  oAuthUrl.searchParams.append('response_type', 'code')
  oAuthUrl.searchParams.append('scope', 'api read_user read_repository write_repository')
  return oAuthUrl
}

function toCredentials(response) {
  return {
    token: response.access_token,
    refresh_token: response.refresh_token,
    refresh_timestamp: getTokenRefreshTimestamp(response),
  }
}

function exchangeCodeForToken(code) {
  return fetchGitLabJson(`${gitlabUrl}/oauth/token`, {
    method: 'POST',
    headers: buildHeaders(),
    json: {
      client_id: Settings.gitlabSync.clientID,
      client_secret: Settings.gitlabSync.clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: Settings.gitlabSync.callbackURL,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'exchangeCodeForToken').then(toCredentials)
}

function refreshToken(refreshToken) {
  return fetchGitLabJson(`${gitlabUrl}/oauth/token`, {
    method: 'POST',
    headers: buildHeaders(),
    json: {
      client_id: Settings.gitlabSync.clientID,
      client_secret: Settings.gitlabSync.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      redirect_uri: Settings.gitlabSync.callbackURL,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'refreshToken').then(toCredentials)
}

function revokeToken(token) {
  const { clientID, clientSecret } = Settings.gitlabSync
  return fetchGitLabNothing(`${gitlabUrl}/oauth/revoke`, {
    method: 'POST',
    headers: buildHeaders(),
    json: {
      client_id: clientID,
      client_secret: clientSecret,
      token,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'revokeToken')
}

// user, orgs, permissions
function getUser(token) {
  return fetchGitLabJson(`${apiBase}/user`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUser').then(({ id, username, name }) => ({ id, login: username, name }))
}

async function getUserAndOrgs(token) {
  const user = await fetchGitLabJson(`${apiBase}/user`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUserAndOrgs:user')

  const groupsUrl = new URL(`${apiBase}/groups`)
  groupsUrl.searchParams.set('all_available', 'true')
  groupsUrl.searchParams.set('min_access_level', '30')
  groupsUrl.searchParams.set('top_level_only', 'true')
  groupsUrl.searchParams.set('per_page', MAX_PER_PAGE.toString())
  groupsUrl.searchParams.set('simple', 'true')

  const groups = await fetchAllPages(groupsUrl, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUserAndOrgs:groups')

  return {
    user: user.username,
    orgs: groups.map(group => group.full_path),
  }
}

function getPushPermission(token, repoFullName) {
  return fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getPushPermission').then(project => {
    const projectAccess = project.permissions?.project_access?.access_level || 0
    const groupAccess = project.permissions?.group_access?.access_level || 0
    return Math.max(projectAccess, groupAccess) >= 30
  })
}

// repos
function resolveNamespaceId(token, org) {
  if (org == null) return Promise.resolve(null)
  if (/^\d+$/.test(org)) return Promise.resolve(Number(org))

  return fetchGitLabJson(`${apiBase}/groups/${encodePath(org)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'resolveNamespaceId').then(group => group.id)
}

async function createRepo(token, { name, description, isPublic, org }) {
  const namespaceId = await resolveNamespaceId(token, org)
  const payload = {
    name,
    description,
    visibility: isPublic ? 'public' : 'private',
    initialize_with_readme: false,
    merge_method: 'merge', // Use merge here to allow for conflict resolution to work properly without the need for a rebase
  }

  if (namespaceId != null) {
    payload.namespace_id = namespaceId
  }

  return fetchGitLabJson(`${apiBase}/projects`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: payload,
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'createRepo').then(repo => ({ fullName: repo.path_with_namespace }))
}

async function listUserRepos(token) {
  const url = new URL(`${apiBase}/projects`)
  url.searchParams.set('membership', 'true')
  url.searchParams.set('per_page', MAX_PER_PAGE.toString())
  url.searchParams.set('simple', 'true')
  url.searchParams.set('order_by', 'last_activity_at')
  url.searchParams.set('sort', 'desc')
  url.searchParams.set('active', 'true') // Only list projects that are not archived and not marked for deletion

  const repos = await fetchAllPages(url, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'listUserRepos')

  return repos.map(repo => ({
    name: repo.name,
    fullName: repo.path_with_namespace,
    defaultBranchName: repo.default_branch,
  }))
}

async function listRepoBranches(token, repoFullName) {
  const url = new URL(`${apiBase}/projects/${projectPath(repoFullName)}/repository/branches`)
  url.searchParams.set('per_page', MAX_PER_PAGE.toString())
  const branches = await fetchAllPages(url, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'listRepoBranches')
  return branches.map(branch => branch.name)
}

// Git (blobs / trees / commits)
// GitLab creates blobs through file actions rather than loose Git objects.
// Cache uploaded bytes per sync so GitMerge can use the same SHA-based plan
// as the other providers without losing hash-only or binary history files.
async function withTemporaryBranches(callback) {
  return syncContext.run({ blobs: new Map(), branches: [] }, async () => {
    try {
      return await callback()
    } finally {
      for (const { token, repoFullName, branch } of syncContext.getStore().branches.reverse()) {
        try {
          await deleteBranch(token, repoFullName, branch)
        } catch (err) {
          logger.warn({ err, repoFullName, branch }, 'Failed to clean up GitLab temporary branch')
        }
      }
    }
  })
}

async function uploadBlob(token, repoFullName, buffer) {
  const context = syncContext.getStore()
  if (!context) throw new Error('GitLab blob preparation requires a sync session')
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'base64')
  const sha = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  context.blobs.set(sha, bytes.toString('base64'))
  return sha
}

function getBlobStream(token, repoFullName, ref, path) {
  const encodedPath = encodePath(path)
  return fetchGitLabStream(`${apiBase}/projects/${projectPath(repoFullName)}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(ref)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getBlobStream')
}

async function createTree(token, repoFullName, entries, baseTree) {
  const previousEntries = Array.isArray(baseTree) ? baseTree : baseTree?.entries || []
  const existing = new Map(previousEntries.map(entry => [entry.path, entry.sha]))
  const limit = pLimit(maxConcurrency)
  const actions = await Promise.all(entries.map(entry => limit(async () => {
    const oldSha = existing.get(entry.path)
    if ((entry.sha == null && !oldSha) || entry.sha === oldSha) return null
    const action = {
      action: entry.sha == null ? 'delete' : oldSha ? 'update' : 'create',
      file_path: entry.path,
    }
    if (entry.sha != null) {
      action.content = entry.content ?? syncContext.getStore()?.blobs.get(entry.sha) ??
        await getBlobContent(token, repoFullName, entry.sha)
      action.encoding = 'base64'
    }
    if (oldSha && baseTree?.commit) {
      // Guard touched files at the expected parent. A branch-head preflight
      // alone cannot protect against an edit arriving before the write.
      const file = await fetchGitLabJson(
        `${apiBase}/projects/${projectPath(repoFullName)}/repository/files/${encodePath(entry.path)}?ref=${encodeURIComponent(baseTree.commit)}`,
        { headers: buildHeaders(token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        'getFileCommit'
      )
      if (!file.last_commit_id) throw new ProviderRequestError('GitLab file commit ID missing', { status: 502 })
      action.last_commit_id = file.last_commit_id
    }
    return action
  })))
  return { entries: actions.filter(Boolean), baseCommit: baseTree?.commit }
}

async function createCommit(token, repoFullName, { tree, message, branch, start_sha, parents = [] }) {
  const parent = parents[0] || tree?.baseCommit || start_sha
  const actions = Array.isArray(tree?.entries) ? tree.entries : []
  if (actions.length === 0 && parent) return parent
  if (!branch && !parent) throw new Error('GitLab commit requires a branch or parent')
  if (!branch) {
    const context = syncContext.getStore()
    if (!context) throw new Error('GitLab commit preparation requires a sync session')
    branch = `overleaf-write-${crypto.randomUUID()}`
    await createBranch(token, repoFullName, branch, parent)
    context.branches.push({ token, repoFullName, branch })
  } else if (parents.length || tree?.baseCommit) {
    if (await getBranchHead(token, repoFullName, branch) !== parent) throw new GitConflictError('GitLab branch changed before commit', { status: 409 })
  }
  const payload = { branch, commit_message: message, actions }
  if (start_sha) payload.start_sha = start_sha
  const result = await fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/repository/commits`, {
    method: 'POST', headers: buildHeaders(token), json: payload,
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'createCommit')
  if (!result.id) throw new ProviderRequestError('GitLab commit SHA missing', { status: 502 })
  return result.id
}

async function getCommitTree(token, repoFullName, commit) {
  return { entries: await listBlobsAtCommit(token, repoFullName, commit), commit }
}

async function listBlobsAtCommit(token, repoFullName, commit) {
  const url = new URL(`${apiBase}/projects/${projectPath(repoFullName)}/repository/tree`)
  url.searchParams.set('ref', commit)
  url.searchParams.set('recursive', 'true')
  url.searchParams.set('per_page', MAX_PER_PAGE.toString())

  const treeEntries = await fetchAllPages(url, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'listBlobsAtCommit')

  return treeEntries
    .filter(entry => entry.type === 'blob')
    .map(entry => ({
      sha: entry.id,
      path: entry.path,
      mode: entry.mode,
      type: 'blob',
    }))
}

async function getBlobContent(token, repoFullName, sha) {
  if (!sha) return null

  const url = `${apiBase}/projects/${projectPath(repoFullName)}/repository/blobs/${sha}`

  return await fetchGitLabJson(url, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'getBlobContent').then(r => r.content || '')
}

async function listNewCommitsWithStatus(token, fullName, branchName, fromCommit) {
  const forward = await compareCommitsFull(token, fullName, fromCommit, branchName);
  const reverse = await compareCommitsFull(token, fullName, branchName, fromCommit);
  const forwardHasCommits = forward.commits.length > 0;
  const reverseHasCommits = reverse.commits.length > 0;

  let diverged = false

  if (forward.compare_same_ref) {
    // Identical
  }
  else if (forwardHasCommits && !reverseHasCommits) {
    // Ahead
  }
  else if (!forwardHasCommits && reverseHasCommits) {
    // Behind (here also considered a diverged state)
    diverged = true
  }
  else if (forwardHasCommits && reverseHasCommits) {
    // Diverged
    diverged = true
  }

  const commits = (forward.commits || []).map(c => ({
    message: c.message || c.title || '',
    author: {
      name: c.author_name || '',
      email: c.author_email || '',
      date: c.created_at || c.committed_date || '',
    },
    sha: c.id,
  }))

  return { commits, diverged }
}

// branches
function getBranchHead(token, repoFullName, branchName) {
  return fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/repository/branches/${encodePath(branchName)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'getBranchHead').then(r => r.commit.id)
}

function createBranch(token, repoFullName, branchName, sha) {
  return fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/repository/branches`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      branch: branchName,
      ref: sha,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'createBranch')
}

function deleteBranch(token, repoFullName, branchName) {
  return fetchGitLabNothing(`${apiBase}/projects/${projectPath(repoFullName)}/repository/branches/${encodePath(branchName)}`, {
    method: 'DELETE',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'deleteBranch')
}

// merge / compare
async function createMergeRequest(token, repoFullName, sourceBranch, targetBranch, title) {
  return fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/merge_requests`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      remove_source_branch: false,
      squash: false,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'createMergeRequest')
}

async function waitForMergeRequestToBeReady(token, repoFullName, mergeRequestIid) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < mergeRequestTimeout) {
    const mergeRequest = await fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/merge_requests/${mergeRequestIid}`, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'getMergeRequest')

    const status = mergeRequest.detailed_merge_status

    if (status === 'mergeable') {
      if (mergeRequest.squash_on_merge === true) {
        return { canMerge: false, reason: 'squash_required' }
      }
      return {
        canMerge: true,
        reason: status,
      }
    }

    if (mergeRequestPendingStates.has(status)) {
      await new Promise(resolve => setTimeout(resolve, mergeRequestPollInterval))
      continue
    }

    if (mergeRequestBlockingStates.has(status)) {
      return {
        canMerge: false,
        reason: status,
      }
    }

    // Unknown future GitLab status, treat as unmergeable to be safe
    return {
      canMerge: false,
      reason: `unknown_status:${status}`,
    }
  }

  throw new ProviderRequestError(`Timed out waiting for GitLab merge request !${mergeRequestIid} readiness`, { status: 504 })
}

async function mergeOpenMergeRequest(token, repoFullName, mergeRequestIid, sha) {
  return fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/merge_requests/${mergeRequestIid}/merge`, {
    method: 'PUT',
    headers: buildHeaders(token),
    json: { sha, squash: false },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'mergeOpenMergeRequest')
}

async function isAncestor(token, repoFullName, ancestor, descendant) {
  try {
    if (ancestor === descendant) return true
    const url = new URL(`${apiBase}/projects/${projectPath(repoFullName)}/repository/merge_base`)
    url.searchParams.append('refs[]', ancestor)
    url.searchParams.append('refs[]', descendant)
    const base = await fetchGitLabJson(url.toString(), {
      headers: buildHeaders(token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'isAncestor')
    return base.id === ancestor
  } catch (err) {
    if (err instanceof NotFoundError) return false
    throw err
  }
}

function getMergeRequest(token, repoFullName, iid) {
  return fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/merge_requests/${iid}`, {
    headers: buildHeaders(token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getMergeRequest')
}

async function mergeBranch(token, repoFullName, base, head, expectedSource, retry = false) {
  let existing
  if (retry) {
    const url = new URL(`${apiBase}/projects/${projectPath(repoFullName)}/merge_requests`)
    url.searchParams.set('state', 'opened')
    url.searchParams.set('source_branch', head)
    url.searchParams.set('target_branch', base)
    const open = await fetchAllPages(url, { headers: buildHeaders(token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, 'findOpenMergeRequest')
    existing = open.find(mr => mr.source_project_id === mr.target_project_id && mr.source_branch === head && mr.target_branch === base)
  }
  const mergeRequest = existing || await createMergeRequest(token, repoFullName, head, base, `Merge ${head} into ${base}`)
  try {
    const ret = await waitForMergeRequestToBeReady(token, repoFullName, mergeRequest.iid)
    if (!ret.canMerge) {
      if (ret.reason === 'conflict') {
        throw new GitConflictError('GitLab merge request has content conflicts')
      }
      throw new ProviderRequestError(`GitLab merge request !${mergeRequest.iid} is blocked: ${ret.reason}`, { status: 409 })
    }
    const sourceHead = expectedSource ?? await getBranchHead(token, repoFullName, head)
    try {
      await mergeOpenMergeRequest(token, repoFullName, mergeRequest.iid, sourceHead)
    } catch (err) {
      // A merge can become blocked after the readiness check. Only an actual
      // content conflict belongs in the manual conflict-resolution state.
      const latest = await getMergeRequest(token, repoFullName, mergeRequest.iid)
      if (latest.state !== 'merged') {
        if (latest.detailed_merge_status === 'conflict') {
          throw new GitConflictError('GitLab merge request has content conflicts')
        }
        throw err
      }
    }
    const mergedHead = await getBranchHead(token, repoFullName, base)
    if (!await isAncestor(token, repoFullName, sourceHead, mergedHead)) {
      throw new ProviderRequestError('GitLab synchronization requires merge commits that preserve source history', { status: 409 })
    }
    return mergedHead
  } catch (err) {
    if (!(err instanceof GitConflictError)) {
      // A policy blocker or timeout is reported as an error, not saved as a
      // manual content conflict. Close the unused MR before removing its source.
      try {
        await fetchGitLabJson(`${apiBase}/projects/${projectPath(repoFullName)}/merge_requests/${mergeRequest.iid}`, {
          method: 'PUT', headers: buildHeaders(token), json: { state_event: 'close' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }, 'closeMergeRequest')
      } catch (cleanupError) {
        logger.warn({ err: cleanupError, repoFullName, iid: mergeRequest.iid }, 'Failed to close unused GitLab merge request')
      }
    }
    throw err
  }
}

function getRepoZipball(token, repoFullName, sha) {
  return fetchGitLabStream(`${apiBase}/projects/${projectPath(repoFullName)}/repository/archive.zip?sha=${encodeURIComponent(sha)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getRepoZipball')
}


async function getFirstParent(token, repo, sha) {
  const result = await fetchGitLabJson(`${apiBase}/projects/${projectPath(repo)}/repository/commits/${sha}`, {
    headers: buildHeaders(token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getFirstParent')
  const parent = result.parent_ids?.[0]
  if (!parent) throw new ProviderRequestError('Missing parent of prepared Git commit.', { status: 502 })
  return parent
}

async function getTreeIdentity(token, repo, commit) {
  // Root directory object IDs cover every nested file, mode and submodule.
  const url = new URL(`${apiBase}/projects/${projectPath(repo)}/repository/tree`)
  url.searchParams.set('ref', commit)
  url.searchParams.set('per_page', MAX_PER_PAGE.toString())
  const root = await fetchAllPages(url, { headers: buildHeaders(token), signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS) }, 'getTreeIdentity')
  return JSON.stringify(root.map(entry => JSON.stringify([entry.path, entry.mode, entry.id])).sort())
}

export default {
  providerName: 'GitLab',
  getFirstParent,
  getTreeIdentity,
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
  getCommitTree,
  listBlobsAtCommit,
  getBlobContent,
  listNewCommitsWithStatus,
  getBranchHead,
  createBranch,
  deleteBranch,
  mergeBranch,
  getMergeRequest,
  isAncestor,
  getRepoZipball,
}
