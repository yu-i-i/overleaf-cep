import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import Csrf from '../../../../app/src/infrastructure/Csrf.mjs'
import GitHubSyncHandler from './GitHubSyncHandler.mjs'
import TokenManager from './TokenManager.mjs'
import api from './GitHubApiClient.mjs'
import GitServerClient from './GitServerClient.mjs'

const gitServerClient = new GitServerClient()
import { doGitMerge } from './GitMerge.mjs'
import { InvalidTokenError, AlreadyExistsError } from './GitSyncErrors.mjs'

// P0-4 / C5: reject non-http(s) server URLs at save time (both addServerConfig
// and linkPAT go through here), so no bad base URL can ever reach githubinterface.
function assertHttpServerUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    const error = new Error('Server URL must be http(s)')
    error.status = 400
    throw error
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || 
    !parsed.hostname) {
    const error = new Error('Server URL must be http(s)')
    error.status = 400
    throw error
  }
}

// P0-9 / U2: map PAT check failures to human messages (the provider status
// tells the real cause; generic messages hide it).
function mapPatCheckError(err) {
  const info = OError.getFullInfo(err)
  const status = info?.status || err?.status
  const original = err?.message || 'Connection check failed'
  if (status === 401) return 'Token invalid or expired. Re-link with a fresh PAT.'
  if (status === 403) return 'Token valid but lacks permission. Check the required scopes in the form help.'
  if (status === 404) return 'Repository not found or invalid URL.'
  return original.slice(0, 500)
}

async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const isConnected = await GitHubSyncHandler.getGitConnState(userId)
    res.json(isConnected)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed to check user connection")
    return res.status(errStatus).json({ message: err.message })
  }
}

async function getProjectState(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const pss = await GitHubSyncHandler.getProjectState(userId, projectId)
    return res.json(pss)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed get project sync state")
    return res.status(errStatus).json({ message: err.message })
  }
}

async function getUserAndOrgs(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { provider, serverUrl, username } = req.query || {}
  try {
    const userAndOrgs = await GitHubSyncHandler.getUserAndOrgs(
      userId, provider, serverUrl, username
    )
    res.json(userAndOrgs)
  } catch (err) {
    // GS-13: propagate the typed status (400/401) instead of a generic 500
    const info = OError.getFullInfo(err)
    logger.error({ info, userId }, 'Failed to list user and orgs')
    res.status(info?.status || 500).json({ message: err.message })
  }
}
async function listUserRepos(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const { provider, serverUrl, username } = req.query || {}
    const repos = await GitHubSyncHandler.listUserRepos(
      userId, provider, serverUrl, username
    )
    res.json({ repos })

  } catch (err) {
    if (err instanceof InvalidTokenError) {
      return res.json(null)
    }
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ userId, info }, 'Failed to get repositories list')
    return res.status(errStatus).json({ message: err.message })
  }
}

async function getMergeOverview(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const commitsAndStatus = await GitHubSyncHandler.getMergeOverview(userId, projectId)
    res.json(commitsAndStatus)

  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error listing commits since last sync')
    return res.status(errStatus).json({ message: err.message })
  }
}

// Import a GitHub repository as a new project
async function importRepo(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { name, fullName, defaultBranchName, provider, serverUrl, username } = req.body || {}

  try {
    const projectId = await GitHubSyncHandler.importRepo(
      userId, name, fullName, defaultBranchName, provider, serverUrl, username
    )
    res.json({ projectId })
  } catch (error) {
    logger.error({ error, userId }, 'Failed to import git repository from server')
    res.status(error.status || 500).json({ message: error.message })
  }
}

// Redirect user to Git server OAuth2 authorization URL
async function oauth2(req, res) {
  const oauth2Url = api.getOAuth2Url()
  oauth2Url.searchParams.append('state', req.csrfToken())
  res.redirect(oauth2Url.toString())
}

// callback
async function oauth2Callback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { code, state } = req.query

  try {
    await Csrf.promises.validateToken(state, req.session)
  } catch {
    HttpErrorHandler.forbidden(req, res, 'Invalid CSRF token')
    return
  }

  let token
  try {
    token = await api.exchangeCodeForToken(code)
    if (!token) {
      HttpErrorHandler.badRequest(req, res, 'Failed to obtain access token from Git server')
      return
    }
  } catch (error) {
    const info = OError.getFullInfo(error)
    logger.error(OError.getFullStack(error))
    logger.error({ info, userId }, 'Failed to obtain access token from Git server')
    HttpErrorHandler.badRequest(req, res, error.message || 'Bad request')
    return
  }

  let linkedUsername = ''
  try {
    // The OAuth slot is account-scoped, so store the linked login as well
    // (non-fatal: the link must not fail on a transient /user lookup)
    const { user } = await gitServerClient.listUserAndOrgs(
      'https://github.com', '', token
    )
    linkedUsername = user || ''
  } catch (err) {
    logger.warn(
      { err, userId },
      'could not resolve GitHub username after OAuth link (non-fatal)'
    )
  }

  try {
    // Dedicated OAuth slot: coexists with any PAT entries the user has.
    await TokenManager.saveOAuth(userId, token, linkedUsername)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, userId }, 'Error saving user token')
    HttpErrorHandler.handleErrorByStatusCode(req, res, err, errStatus)
    return
  }

  // Save success message in session to display on redirect
  req.session.projectSyncSuccessMessage =
    req.i18n.translate('github_successfully_linked_description')
  res.redirect('/user/settings?oauth-complete=github#project-sync')
}

// Unlink the user's GitHub OAuth account (PAT entries are untouched)
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await TokenManager.removeUserToken(userId)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, userId }, 'Error removing user credentials')
    return res.status(errStatus).json({ message: err.message })
  }
  res.sendStatus(200)
}

// Export project to Git server
// Expected req.body:
//   name (string): repository name
//   description (string, optional): repository description
//   isPublic (boolean, optional): if true, the repository is public
//   org (string, optional): if provided, repository will be created under this organization

async function exportProject(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params

  try {
    await GitHubSyncHandler.exportProject(userId, projectId, req.body)

  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error exporting project')
    let key = 'github_validation_check'
    if (err instanceof AlreadyExistsError) key = 'github_validation_name_exists'
    else if (errStatus === 401 || errStatus === 403) key = 'github_validation_check_auth'
    return res.status(errStatus).json({ key, message: err.message })
  }
  res.sendStatus(200)
}

async function gitMerge(req, res) {
  const { project_id: projectId } = req.params
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    // GS-17: explicit 401 instead of letting a missing session fail downstream
    if (!userId) {
      return res.status(401).json({ message: 'not logged in' })
    }
    const commitMessage =  req.body?.message || 'Updates from Overleaf'
    const claimConflictIsResolved = req.body.claimConflictIsResolved

    const mergeResult = await doGitMerge(userId, projectId, commitMessage, claimConflictIsResolved)

    res.json(mergeResult)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error syncing project to GitHub')
    return res.status(errStatus).json({ message: err.message })
  }
}

// Unlink user's Git server account
async function unlinkRepo(req, res) {
  const { project_id: projectId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const ownerEmail = await GitHubSyncHandler.unlinkRepo(userId, projectId)
    if (ownerEmail) return res.status(403).json({ ownerEmail })
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus  = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, projectId }, 'Error unlinking repo from project')
    return res.status(errStatus).json({ message: err.message })
  }
  res.sendStatus(200)
}

// Get user's configured Git servers (list)
async function getUserServers(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  
  try {
    const servers = await TokenManager.getPublicServers(userId)
    return res.json(servers)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ userId, info }, 'Failed to get user servers')
    return res.status(errStatus).json({ message: err.message })
  }
}

// Add new Git server configuration
async function addServerConfig(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { provider, url, username } = req.body
  
  try {
    if (!provider || !url || !username) {
      return res.status(400).json({ message: 'Missing required fields' })
    }
    assertHttpServerUrl(url)
    
    await TokenManager.addServerConfig(userId, provider, url, username)
    return res.json({ success: true })
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ userId, info }, 'Failed to add server config')
    return res.status(errStatus).json({ message: err.message })
  }
}

// Remove Git server configuration
// id format: provider:url:username (username optional for legacy ids)
async function removeServerConfig(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { id } = req.params
  
  try {
    // Parse id as "provider:url:username" (url may contain colons)
    const sep = id.indexOf(':')
    if (sep < 1) {
      return res.status(400).json({ message: 'Invalid server ID format' })
    }
    const provider = id.slice(0, sep)
    const rest = id.slice(sep + 1)
    // The username part is present when the last colon sits beyond the
    // "https:" colon of the URL.
    const lastSep = rest.lastIndexOf(':')
    const hasUsername = lastSep > 7
    const serverUrl = hasUsername ? rest.slice(0, lastSep) : rest
    const username = hasUsername ? rest.slice(lastSep + 1) : undefined

    await TokenManager.removeServer(userId, provider, serverUrl, username)
    return res.json({ success: true })
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ userId, info }, 'Failed to remove server config')
    return res.status(errStatus).json({ message: err.message })
  }
}

// PAT link endpoint (for direct PAT input)
async function linkPAT(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { provider, url, username, pat } = req.body || {}

  try {
    if (!provider || !url || !username || !pat) {
      return res.status(400).json({ message: 'Missing required fields' })
    }
    assertHttpServerUrl(url)

    // Save the PAT under its (provider, url, username) account identity.
    // Re-saving the same account replaces only that account's token.
    await TokenManager.saveUserPAT(userId, provider, url, username, pat)

    // Non-fatal verification: try a connection check
    let check = { ok: false, message: 'not checked' }
    try {
      check = await testServerConnection(userId, provider, url, username, null)
    } catch (err) {
      check = { ok: false, message: mapPatCheckError(err) }
    }

    return res.json({ success: true, check })
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ userId, info }, 'Failed to link PAT')
    return res.status(errStatus).json({ message: err.message })
  }
}

/**
 * Shared logic for verifying a stored (or supplied) PAT against its server.
 */
async function testServerConnection(userId, provider, serverUrl, username, pat) {
  let token = pat
  let uname = username
  if (!token) {
    const creds = await TokenManager.getUserPATCredentials(userId, provider, serverUrl)
    token = creds.token
    if (!uname) uname = creds.username
  }

  const result = await gitServerClient.check(serverUrl, uname, token)
  return { ok: !!result, login: '' }
}

// Test a saved git server connection
async function testServer(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { provider, url, username } = req.body || {}

  try {
    if (!provider || !url) {
      return res.status(400).json({ message: 'Missing provider or url' })
    }
    const result = await testServerConnection(
      userId, provider, url, username || undefined, null
    )
    res.json({ ok: result?.ok || false })
  } catch (err) {
    const info = OError.getFullInfo(err)
    logger.debug({ userId, info }, 'git server test failed')
    return res.status(200).json({ ok: false, message: mapPatCheckError(err) })
  }
}

export default {
  getConnectionStatus: expressify(getConnectionStatus),
  getProjectState: expressify(getProjectState),
  getUserServers: expressify(getUserServers),
  addServerConfig: expressify(addServerConfig),
  removeServerConfig: expressify(removeServerConfig),
  linkPAT: expressify(linkPAT),
  testServer: expressify(testServer),
  oauth2: expressify(oauth2),
  unlink: expressify(unlink),
  getUserAndOrgs: expressify(getUserAndOrgs),
  oauth2Callback: expressify(oauth2Callback),
  listUserRepos: expressify(listUserRepos),
  importRepo: expressify(importRepo),
  exportProject: expressify(exportProject),
  getMergeOverview: expressify(getMergeOverview),
  gitMerge: expressify(gitMerge),
  unlinkRepo: expressify(unlinkRepo),
}
