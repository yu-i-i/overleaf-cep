import AbortError from 'node-fetch'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

import {
  fetchJson,
  fetchJsonWithResponse,
  fetchStreamWithResponse,
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
const MAX_PER_PAGE = 100  // GitHub REST API limit

const maxConcurrency = Settings.githubSync.apiMaxConcurrency

const githubUrl = Settings.githubSync.url
const isEnterprise = !['https://github.com', 'https://www.github.com'].includes(githubUrl.toLowerCase())
const githubApiBase = isEnterprise ? `${githubUrl}/api/v3` : 'https://api.github.com'
const githubGraphQL = isEnterprise ? `${githubUrl}/api/graphql` : 'https://api.github.com/graphql'

function buildHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Overleaf-CEP-GitHub-Sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// Error handling
function isRateLimitError(response) {
  const remaining = response.headers.get('x-ratelimit-remaining')
  const retryAfter = response.headers.get('retry-after')

  return remaining === '0' || retryAfter != null
}

function isRepositoryAlreadyExistsError(err) {
  if (err.response?.status !== 422) {
    return false
  }

  let body = err.body

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return false
    }
  }

  const errors = body?.errors

  if (!Array.isArray(errors)) {
    return false
  }

  return errors.some(error =>
    error?.resource === 'Repository' &&
    error?.field === 'name' &&
    typeof error?.message === 'string' &&
    error.message.toLowerCase().includes('already exists')
  )
}

function normalizeGitHubError(err, operation) {
  logger.error({ operation }, 'GitHub API request failed')

  if ((err.name === 'AbortError' || err.name === 'TimeoutError')) {
    throw new ProviderRequestError('GitHub request timed out', { status: 504 }, err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new ProviderRequestError('Something wrong with GitHub request', { status: 500 }, err)
  }

  const status = err.response?.status || 500

  if (status === 401) {
    throw new InvalidTokenError('Invalid token', { status }, err)
  }

  if (status === 404) {
    throw new NotFoundError('Not found', { status }, err)
  }

  if (status === 409) {
    throw new GitConflictError()
  }

  if (status === 403 || status === 429) {
    if (status === 429 || isRateLimitError(err.response)) throw new RateLimitError('Git provider rate limit reached. Wait before syncing again.', { status: 429 }, err)
    throw new PermissionDeniedError('Permission denied', { status: 403 }, err)
  }

  if (status === 422) {
    if (isRepositoryAlreadyExistsError(err)) {
      throw new AlreadyExistsError('Repository already exists', { status }, err)
    }
  }

  throw new ProviderRequestError('GitHub request failed', { status }, err)
}

// wrappers
function fetchGitHubJson(url, options, operation) {
  return fetchJson(url, options).catch(err => {
    normalizeGitHubError(err, operation)
  })
}

function fetchGitHubJsonWithResponse(url, options, operation) {
  return fetchJsonWithResponse(url, options).catch(err => {
    normalizeGitHubError(err, operation)
  })
}

function fetchGitHubStreamWithResponse(url, options, operation) {
  return fetchStreamWithResponse(url, options).catch(err => {
    normalizeGitHubError(err, operation)
  })
}

function fetchGitHubNothing(url, options, operation) {
  return fetchNothing(url, options).catch(err => {
    normalizeGitHubError(err, operation)
  })
}

function fetchGitHubStream(url, options, operation) {
  return fetchStream(url, options).catch(err => {
    normalizeGitHubError(err, operation)
  })
}

// ---------------------- exports ------------------------------- //

// OAuth
function getOAuth2Url() {
  const oAuthUrl = new URL(`${githubUrl}/login/oauth/authorize`)
  oAuthUrl.searchParams.append('client_id', Settings.githubSync.clientID)
  oAuthUrl.searchParams.append('redirect_uri', Settings.githubSync.callbackURL)
  oAuthUrl.searchParams.append('scope', 'read:org,repo,workflow')
  return oAuthUrl
}

function exchangeCodeForToken(code) {
  return fetchGitHubJson(`${githubUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: buildHeaders(),
    json: {
      code,
      client_id: Settings.githubSync.clientID,
      client_secret: Settings.githubSync.clientSecret,
      redirect_uri: Settings.githubSync.callbackURL,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'exchangeCodeForToken').then(r => ({ token: r.access_token }))
}

function revokeToken(token) {
  const { clientID, clientSecret } = Settings.githubSync
  return fetchGitHubNothing(`${githubApiBase}/applications/${clientID}/token`, {
    method: 'DELETE',
    headers: buildHeaders(),
    basicAuth: {
      user: clientID,
      password: clientSecret,
    },
    json: { access_token: token },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'revokeToken')
}

// user, orgs, permissions
function getUser(token) {
  return fetchGitHubJson(`${githubApiBase}/user`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUser').then(({ id, login, name }) => ({ id, login, name }))
}

async function getUserAndOrgs(token) {
  const query = `
    query {
      viewer {
        login
        organizations(first: 100) {
          nodes {
            login
            viewerCanCreateRepositories
          }
        }
      }
    }
  `
  const json = await fetchGitHubJson(githubGraphQL, {
    method: 'POST',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    json: { query }
  }, 'getUserAndOrgs')

  const viewer = json.data.viewer

  return {
    user: viewer.login,
    orgs: viewer.organizations.nodes.map(o => o.login)
  }
}

function getPushPermission(token, repoFullName) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getPushPrmission').then(repo => (repo.permissions?.push === true))
}

// repos
function createRepo(token, { name, description, isPublic, org }) {
  const url = org ? `${githubApiBase}/orgs/${org}/repos` : `${githubApiBase}/user/repos`
  return fetchGitHubJson(url, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      name,
      description,
      private: !isPublic,
      auto_init: true,
    },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'createRepo').then(repo => ({ fullName: repo.full_name, defaultBranch: repo.default_branch }))
}

async function _listUserReposPage(token, page) {
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: MAX_PER_PAGE.toString(),
  })

  const { json, response } = await fetchGitHubJsonWithResponse(`${githubApiBase}/user/repos?${params}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, '_listUserReposPage')

  const link = response.headers.get('link') || ''
  const hasNext = link.includes('rel="next"')

  return {
    repos: json.map(r => ({
      name: r.name,
      fullName: r.full_name,
      defaultBranchName: r.default_branch,
    })),
    hasNext,
  }
}

async function listUserRepos(token) {
  let all = []
  let page = 1

  while (true) {
    const { repos, hasNext } = await _listUserReposPage(token, page)
    all = all.concat(repos)
    if (!hasNext) break
    page++
  }

  return all
}

async function listRepoBranches(token, repoFullName) {
  const branches = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({ page: page.toString(), per_page: MAX_PER_PAGE.toString() })
    const { json, response } = await fetchGitHubJsonWithResponse(`${githubApiBase}/repos/${repoFullName}/branches?${params}`, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'listRepoBranches')
    branches.push(...json.map(branch => branch.name))
    if (!(response.headers.get('link') || '').includes('rel="next"')) break
    page++
  }
  return branches
}

// Git (blobs / trees / commits)
function uploadBlob(token, repoFullName, buffer) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/git/blobs`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      content: buffer,
      encoding: 'base64',
    },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'uploadBlob').then(r => r.sha)
}

function getBlobStream(token, repoFullName, ref, path) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/')

  return fetchGitHubStream(`${githubApiBase}/repos/${repoFullName}/contents/${encodedPath}?ref=${ref}`, {
    headers: {
      ...buildHeaders(token),
      Accept: 'application/vnd.github.raw',
    },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getBlobStream')
}

function createTree(token, repoFullName, entries, base_tree) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/git/trees`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      tree: entries.map(e => ({
        path: e.path,
        sha: e.sha,
        mode: '100644',
        type: 'blob',
      })),
      ...(base_tree && { base_tree }),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'createTree').then(r => r.sha)
}

function createCommit(token, repoFullName, { tree, message, parents = [] }) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/git/commits`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      tree,
      message,
      parents,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'createCommit').then(r => r.sha)
}

function getCommitTree(token, repoFullName, commit) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/git/commits/${commit}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'getCommitTree').then(r => r.tree.sha)
}

async function listBlobsAtCommit(token, repoFullName, commit) {
  const treeUrl = `${githubApiBase}/repos/${repoFullName}/git/trees/`
  const options = () => ({
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  })
  const result = await fetchGitHubJson(`${treeUrl}${commit}?recursive=1`, options(), 'listBlobsAtCommit')
  if (!result.truncated) {
    if (!Array.isArray(result.tree)) throw new ProviderRequestError('GitHub tree missing', { status: 502 })
    return result.tree
      .filter(entry => entry.type === 'blob')
      .map(entry => ({ sha: entry.sha, path: entry.path, mode: entry.mode }))
  }

  const blobs = []
  async function visit(treeSha, prefix) {
    const data = await fetchGitHubJson(`${treeUrl}${treeSha}`, options(), 'listBlobsAtCommit')
    if (data.truncated || !Array.isArray(data.tree)) {
      throw new ProviderRequestError('GitHub non-recursive tree response incomplete', { status: 502 })
    }
    for (const entry of data.tree) {
      const path = prefix + entry.path
      if (entry.type === 'blob') blobs.push({ sha: entry.sha, path, mode: entry.mode })
      else if (entry.type === 'tree') await visit(entry.sha, `${path}/`)
    }
  }
  await visit(commit, '')
  return blobs
}

async function isAncestor(token, repoFullName, ancestor, descendant) {
  try {
    if (ancestor === descendant) return true
    const data = await fetchGitHubJson(
      `${githubApiBase}/repos/${repoFullName}/compare/${encodeURIComponent(ancestor)}...${encodeURIComponent(descendant)}`,
      { headers: buildHeaders(token), signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS) },
      'isAncestor'
    )
    return data.status === 'ahead' || data.status === 'identical'
  } catch (err) {
    if (err instanceof NotFoundError) return false
    throw err
  }
}

async function listNewCommitsWithStatus(token, fullName, branchName, fromCommit) {
  const url = `${githubApiBase}/repos/${fullName}/compare/${fromCommit}...${encodeURIComponent(branchName)}`
  const data = await fetchGitHubJson(url, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'listNewCommitsWithStatus')

  const commits = (data.commits || []).map(c => ({
    message: c.commit?.message || '',
    author: {
      name: c.commit?.author?.name || '',
      email: c.commit?.author?.email || '',
      date: c.commit?.author?.date || '',
    },
    sha: c.sha,
  }))
  const diverged = (data.status === 'diverged' || data.status === 'behind')
  return { commits, diverged }
}

// branches
function getBranchHead(token, repoFullName, branchName) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/git/ref/heads/${encodeURIComponent(branchName)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'getBranchHead').then(r => r.object.sha)
}

function createBranch(token, repoFullName, branchName, sha) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/git/refs`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      ref: `refs/heads/${branchName}`,
      sha,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'createBranch')
}

function updateBranch(token, repoFullName, branchName, sha, force = false) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: 'PATCH',
    headers: buildHeaders(token),
    json: { sha, force },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'updateBranch')
}

function deleteBranch(token, repoFullName, branchName) {
  return fetchGitHubNothing(`${githubApiBase}/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: 'DELETE',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'deleteBranch')
}

function setDefaultBranch(token, repoFullName, branchName) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}`, {
    method: 'PATCH',
    headers: buildHeaders(token),
    json: { default_branch: branchName },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'setDefaultBranch')
}

// merge / compare
function mergeBranch(token, repoFullName, base, head, expectedSource) {
  return fetchGitHubJson(`${githubApiBase}/repos/${repoFullName}/merges`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: { base, head: expectedSource ?? head },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'mergeBranch').then(r => r.sha)
}

// zip
function getRepoZipball(token, repoFullName, sha) {
  return fetchGitHubStream(`${githubApiBase}/repos/${repoFullName}/zipball/${sha}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getRepoZipball')
}

function publishCommit(token, repoFullName, branchName, sha) {
  return updateBranch(token, repoFullName, branchName, sha)
}

async function publishInitialCommit(token, repo, branchName, sha) {
  if (branchName === repo.defaultBranch) {
    await updateBranch(token, repo.fullName, branchName, sha, true)
  } else {
    await createBranch(token, repo.fullName, branchName, sha)
    await setDefaultBranch(token, repo.fullName, branchName)
  }
}

export default {
  providerName: 'GitHub',
  revokeReplacedToken: revokeToken,
  publishInitialCommit,
  getTreeIdentity: getCommitTree,
  publishCommit,
  maxConcurrency,
  getOAuth2Url,
  exchangeCodeForToken,
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
  listNewCommitsWithStatus,
  isAncestor,
  getBranchHead,
  createBranch,
  updateBranch,
  deleteBranch,
  setDefaultBranch,
  mergeBranch,
  getRepoZipball,
}
