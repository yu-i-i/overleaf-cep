import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import crypto from 'node:crypto'

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
} from './GitSyncErrors.mjs'

const GITLAB_URL = process.env.GITLAB_SYNC_URL
const GITLAB_API_BASE = `${GITLAB_URL}/api/v4`
const GITLAB_DEFAULT_BRANCH = process.env.GITLAB_DEFAULT_BRANCH || 'main'
const MAX_PER_PAGE = 100

const REQUEST_TIMEOUT_MS = 60 * 1000
const REQUEST_LONG_TIMEOUT_MS = 600 * 1000

const MERGE_REQUEST_POLL_INTERVAL_MS = process.env.GITLAB_MERGE_REQUEST_POLL_INTERVAL_MS || 1000
const MERGE_REQUEST_TIMEOUT_MS = process.env.GITLAB_MERGE_REQUEST_TIMEOUT_MS || 60_000

const mergeRequestPendingStates = new Set([
  'unchecked',
  'checking',
  'preparing',
  'approvals_syncing',
])

const mergeRequestBlockingStates = new Set([
  'conflict',
  'ci_must_pass',
  'ci_still_running',
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



const maxConcurrency = process.env.GITLAB_API_MAX_CONCURRENCY || 5

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

  const json_data = JSON.parse(err.body)
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

  if (err.name === 'AbortError') {
    throw new ProviderRequestError('GitLab request timed out', { status: 504 }, err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new ProviderRequestError('Something wrong with GitLab request', { status: 500 }, err)
  }

  const status = err.response?.status || 500

  if (status === 401) {
    const json_body = JSON.parse(err.body) || {}
    if (json_body && json_body.error && json_body.error.toLowerCase() === 'invalid_token') {
      throw new ExpiredTokenError('Token expired', { status }, err)
    }

    throw new InvalidTokenError('Invalid token', { status }, err)
  }

  if (status === 404) {
    throw new NotFoundError('Not found', { status }, err)
  }

  if (status === 409) {
    throw new GitConflictError()
  }

  if (status === 403 || status === 429) {
    if (isRateLimitError(err.response)) throw new RateLimitError('Rate limit exeeded', { status: 429 }, err)
    throw new PermissionDeniedError('Permission denied', { status: 403 }, err)
  }

  if (status === 400) {
    if (isRepositoryAlreadyExistsError(err)) {
      throw new AlreadyExistsError('Repository already exists', { status }, err)
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

// ---------------------- exports ------------------------------- //

// OAuth
function getOAuth2Url() {
  const oAuthUrl = new URL(`${GITLAB_URL}/oauth/authorize`)
  oAuthUrl.searchParams.append('client_id', Settings.gitlabSync.clientID)
  oAuthUrl.searchParams.append('redirect_uri', Settings.gitlabSync.callbackURL)
  oAuthUrl.searchParams.append('response_type', 'code')
  oAuthUrl.searchParams.append('scope', 'api read_user read_repository write_repository')
  return oAuthUrl
}

function exchangeCodeForToken(code) {
  return fetchGitLabJson(`${GITLAB_URL}/oauth/token`, {
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
  }, 'exchangeCodeForToken').then(r => [r.access_token, r.refresh_token, getTokenRefreshTimestamp(r)] )
}

function refreshToken(refreshToken) {
	return fetchGitLabJson(`${GITLAB_URL}/oauth/token`, {
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
	}, 'refreshToken').then(r => [r.access_token, r.refresh_token, getTokenRefreshTimestamp(r)])
}

function revokeToken(token) {
  const { clientID, clientSecret } = Settings.gitlabSync
  return fetchGitLabNothing(`${GITLAB_URL}/oauth/revoke`, {
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
  return fetchGitLabJson(`${GITLAB_API_BASE}/user`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUser').then(({ id, username, name }) => ({ id, login: username, name }))
}

async function getUserAndOrgs(token) {
  const user = await fetchGitLabJson(`${GITLAB_API_BASE}/user`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUserAndOrgs:user')

  const groupsUrl = new URL(`${GITLAB_API_BASE}/groups`)
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
  return fetchGitLabJson(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}`, {
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

  return fetchGitLabJson(`${GITLAB_API_BASE}/groups/${encodePath(org)}`, {
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
    default_branch: GITLAB_DEFAULT_BRANCH,
    merge_method: 'merge', // Use merge here to allow for conflict resolution to work properly without the need for a rebase
  }

  if (namespaceId != null) {
    payload.namespace_id = namespaceId
  }

  return fetchGitLabJson(`${GITLAB_API_BASE}/projects`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: payload,
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'createRepo')
}

async function listUserRepos(token) {
  const url = new URL(`${GITLAB_API_BASE}/projects`)
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

// Git (blobs / trees / commits)
function uploadBlob(token, repoFullName, buffer) {
  void token
  void repoFullName

  if (Buffer.isBuffer(buffer)) {
    return Promise.resolve(buffer.toString('base64'))
  }

  if (typeof buffer === 'string') {
    return Promise.resolve(buffer)
  }

  return Promise.resolve(String(buffer))
}

function getBlobStream(token, repoFullName, ref, path) {
  const encodedPath = encodePath(path)
  return fetchGitLabStream(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(ref)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getBlobStream')
}

function createTree(token, repoFullName, entries, baseTree) {
  void token
  void repoFullName

  const existingPaths = new Set((baseTree || []).map(entry => entry.path))
  const actions = []

  for (const entry of entries) {
    if (entry.sha == null) {
      actions.push({
        action: 'delete',
        file_path: entry.path,
      })
      continue
    }

    actions.push({
      action: existingPaths.has(entry.path) ? 'update' : 'create',
      file_path: entry.path,
      content: entry.content,
      encoding: 'base64',
    })
  }

  return Promise.resolve({
    baseTree: baseTree || [],
    entries: actions,
  })
}

function createCommit(token, repoFullName, { tree, message, branch, start_sha, force = false }) {
  const actions = Array.isArray(tree?.entries) ? tree.entries : []

  let payload = {
	branch: branch || GITLAB_DEFAULT_BRANCH,
	commit_message: message,
	actions,
  }

  if (branch && branch != GITLAB_DEFAULT_BRANCH) {
	payload.start_sha = start_sha
  }

  return fetchGitLabJson(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/commits`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: payload,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'createCommit').then(r => r.id) // For GitLab id refers to the SHA of the created commit
}

function getCommitTree(token, repoFullName, commit) {
  return listBlobsAtCommit(token, repoFullName, commit)
}

async function listBlobsAtCommit(token, repoFullName, commit) {
  const url = new URL(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/tree`)
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
  const url = `${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/blobs/${sha}`

  try {
	const json = await fetchGitLabJson(url, {
	  headers: buildHeaders(token),
	  signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
	}, 'getBlobContent')
	return json.content
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch blob content from GitLab', { repoFullName, sha })
  }
}

async function listNewCommitsWithStatus(token, fullName, branchName, fromCommit) {
  const url = new URL(`${GITLAB_API_BASE}/projects/${projectPath(fullName)}/repository/compare`)
  url.searchParams.set('from', fromCommit)
  url.searchParams.set('to', branchName)
  url.searchParams.set('straight', 'true')

  const data = await fetchGitLabJson(url.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'listNewCommitsWithStatus')

  const commits = (data.commits || []).map(c => ({
    message: c.message || c.title || '',
    author: {
      name: c.author_name || '',
      email: c.author_email || '',
      date: c.created_at || c.committed_date || '',
    },
    sha: c.id,
  }))

  return { commits, diverged: commits.length > 0 }
}

// branches
function getBranchHead(token, repoFullName, branchName) {
  return fetchGitLabJson(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/branches/${encodePath(branchName)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'getBranchHead').then(r => r.commit.id)
}

function createBranch(token, repoFullName, branchName, sha) {
  return fetchGitLabJson(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/branches`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      branch: branchName,
      ref: sha,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'createBranch')
}

function updateBranch(token, repoFullName, branchName, sha, force = false) {
// Update functionality does not exist in GitLab API as it automatically updates the branch when a commit is made to it
}

function deleteBranch(token, repoFullName, branchName) {
  return fetchGitLabNothing(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/branches/${encodePath(branchName)}`, {
    method: 'DELETE',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'deleteBranch')
}

// merge / compare
async function createMergeRequest(token, repoFullName, sourceBranch, targetBranch, title) {
  return fetchGitLabJson(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/merge_requests`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      remove_source_branch: true,
      squash: false,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'createMergeRequest')
}

async function waitForMergeRequestToBeReady(token, repoFullName, mergeRequestIid) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < MERGE_REQUEST_TIMEOUT_MS) {
    const mergeRequest = await fetchGitLabJson(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/merge_requests/${mergeRequestIid}`, {
        headers: buildHeaders(token),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }, 'getMergeRequest')

    const status = mergeRequest.detailed_merge_status

    if (status === 'mergeable') {
      return {
        canMerge: true,
		reason: status,
      }
    }

    if (mergeRequestPendingStates.has(status)) {
      await new Promise(resolve => setTimeout(resolve, MERGE_REQUEST_POLL_INTERVAL_MS))
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

  throw new Error(`Timed out waiting for merge request ${mergeRequestIid} readiness`)
}

async function mergeOpenMergeRequest(token, repoFullName, mergeRequestIid) {
  return fetchGitLabJson(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/merge_requests/${mergeRequestIid}/merge`, {
    method: 'PUT',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'mergeOpenMergeRequest')
}

function mergeBranch(token, repoFullName, base, head) {
  return createMergeRequest(token, repoFullName, head, base, `Merge ${head} into ${base}`)
    .then(async mergeRequest => {
	  const ret = await waitForMergeRequestToBeReady(token, repoFullName, mergeRequest.iid)
	  if (!ret.canMerge) {
        throw new GitConflictError("Merge request cannot be merged due to conflicts, reason: " + ret.reason)
     }

	  await mergeOpenMergeRequest(token, repoFullName, mergeRequest.iid)
      return getBranchHead(token, repoFullName, base)
    })
}

function compareCommits(token, repoFullName, from, to) {
  const url = new URL(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/compare`)
  url.searchParams.set('from', from)
  url.searchParams.set('to', to)
  url.searchParams.set('straight', 'true')

  return fetchGitLabJson(url.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'compareCommits').then(r => r.diffs || [])
}

function getRepoZipball(token, repoFullName, sha) {
  return fetchGitLabStream(`${GITLAB_API_BASE}/projects/${projectPath(repoFullName)}/repository/archive.zip?sha=${encodeURIComponent(sha)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getRepoZipball')
}

export default {
  maxConcurrency,
  getOAuth2Url,
  exchangeCodeForToken,
  refreshToken,
  revokeToken,
  getUser,
  getUserAndOrgs,
  getPushPermission,
  createRepo,
  listUserRepos,
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
  updateBranch,
  deleteBranch,
  mergeBranch,
  compareCommits,
  getRepoZipball,
}