import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import HttpErrorHandler from '../../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import SessionManager from '../../../../../app/src/Features/Authentication/SessionManager.mjs'
import Csrf from '../../../../../app/src/infrastructure/Csrf.mjs'
import { InvalidTokenError, ExpiredTokenError, GitNotLinkedError, AlreadyExistsError, GitSyncInterruptedError } from './GitSyncErrors.mjs'

export default function createGitSyncController({ GitSyncHandler, TokenManager, api, doGitMerge, provider }) {
  async function getConnectionStatus(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)

    try {
      const isConnected = await GitSyncHandler.getGitConnState(userId)
      res.json(isConnected)
    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ info }, "failed to check user connection")
      return res.status(errStatus).json({ message: err.message })
    }
  }

  async function getProjectState(req, res) {
    const { project_id: projectId } = req.params
    const userId = SessionManager.getLoggedInUserId(req.session)

    try {
      const pss = await GitSyncHandler.getProjectState(userId, projectId)
      return res.json(pss)
    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ info }, "failed get project sync state")
      return res.status(errStatus).json({ message: err.message })
    }
  }

  async function getUserAndOrgs(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const userAndOrgs = await GitSyncHandler.getUserAndOrgs(userId)
    res.json(userAndOrgs)
  }
  async function listUserRepos(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)

    try {
      const repos = await GitSyncHandler.listUserRepos(userId)
      res.json({ repos })

    } catch (err) {
      if ((err instanceof InvalidTokenError || err instanceof ExpiredTokenError)) {
        return res.json(null)
      }
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ userId, info }, 'Failed to get repositories list')
      return res.status(errStatus).json({ message: err.message })
    }
  }

  async function listRepoBranches(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { repo } = req.query
    if (typeof repo !== 'string' || !repo) return res.status(400).json({ message: 'Missing repository' })
    try {
      const branches = await GitSyncHandler.listRepoBranches(userId, repo)
      return res.json({ branches })
    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error({ err, userId, repo }, 'Failed to list repository branches')
      return res.status(errStatus).json({ message: err.message })
    }
  }

  async function getMergeOverview(req, res) {
    const { project_id: projectId } = req.params
    const userId = SessionManager.getLoggedInUserId(req.session)
    try {
      const commitsAndStatus = await GitSyncHandler.getMergeOverview(userId, projectId)
      res.json(commitsAndStatus)

    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ info, projectId }, 'Error listing commits since last sync')
      return res.status(errStatus).json({ message: err.message })
    }
  }

  // Import a GitHub repository as a new project
  async function importRepo(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { name, fullName, defaultBranchName } = req.body

    try {
      const { retryProjectId } = req.body
      const pending = req.session.gitSyncImports ??= {}
      let result
      if (retryProjectId != null) {
        const key = provider + ':' + retryProjectId
        const imported = pending[key]
        if (!imported || imported.userId !== userId.toString()) {
          return res.status(409).json({ message: 'Import retry is unavailable in this session' })
        }
        result = await GitSyncHandler.linkImportedProject(userId, imported, true)
      } else {
        result = await GitSyncHandler.importRepo(userId, name, fullName, defaultBranchName)
      }
      const key = provider + ':' + result.projectId
      if (result.linked) delete pending[key]
      else pending[key] = result.imported
      res.json({ projectId: result.projectId, linked: result.linked })
    } catch (error) {
      logger.error({ error, userId }, 'Failed to import git repository from server')
      const names = new Set()
      for (let cause = error; cause && !names.has(cause); cause = cause.cause) {
        names.add(cause)
        names.add(cause.name)
        names.add(cause.constructor?.name)
      }
      const status = OError.getFullInfo(error)?.status || error.status || 500
      if (names.has('ZipContentsTooLargeError')) {
        return res.status(413).json({ message: 'This repository exceeds the Overleaf archive size or file-count limit. Import a smaller branch.' })
      }
      if (names.has('TooManyFilesError')) {
        return res.status(413).json({ message: 'This repository has too many files or folders for an Overleaf project. Reduce the number and try again.' })
      }
      return res.status(status).json({ message: status === 429 ? 'Git provider rate limit reached. Wait before importing again.' : error.message })
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

    let credentials
    try {
      credentials = await TokenManager.exchangeCodeForToken(code)
    } catch (err) {
      const info = OError.getFullInfo(err)
      logger.error(OError.getFullStack(err))
      logger.error({ info, userId }, 'Failed to obtain access token from Git server')
      HttpErrorHandler.badRequest(req, res, err.message || 'Bad request')
      return
    }

    try {
      await TokenManager.saveUserToken(userId, credentials)
    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ info, userId }, 'Error saving user token')
      HttpErrorHandler.handleErrorByStatusCode(req, res, err, errStatus)
      return
    }

    // Save success message in session to display on redirect
    req.session.projectSyncSuccessMessage =
      req.i18n.translate('github_successfully_linked_description', { provider: api.providerName })
    res.redirect(`/user/settings?oauth-complete=${provider}#project-sync`)
  }

  // Unlink user's Git server account
  async function unlink(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    try {
      await TokenManager.removeUserToken(userId)
    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
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
  //   branchName (string, required): branch to synchronize

  async function exportProject(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { project_id: projectId } = req.params

    try {
      if (api.withTemporaryBranches) {
        await api.withTemporaryBranches(() => GitSyncHandler.exportProject(userId, projectId, req.body))
      } else {
        await GitSyncHandler.exportProject(userId, projectId, req.body)
      }

    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ info, projectId }, 'Error exporting project')
      let key = 'github_validation_check'
      if (err instanceof AlreadyExistsError) key = 'github_validation_name_exists'
      else if (errStatus === 400 && info?.key) key = info.key
      else if (errStatus === 401 || errStatus === 403) key = 'github_validation_check_auth'
      return res.status(errStatus).json({ key, message: err.message })
    }
    res.sendStatus(200)
  }

  async function gitMerge(req, res) {
    const { project_id: projectId } = req.params
    try {
      const userId = SessionManager.getLoggedInUserId(req.session)
      const commitMessage =  req.body?.message || 'Updates from Overleaf'
      const claimConflictIsResolved = req.body.claimConflictIsResolved

      const mergeResult = await doGitMerge(userId, projectId, commitMessage, claimConflictIsResolved, req.body.resolutionConfirmation)

      res.json(mergeResult)
    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ info, projectId, provider }, 'Error syncing project to Git server')
      if (info?.key === 'resolution_confirmation_required') {
        return res.status(409).json({ key: info.key, resolution: info.resolution })
      }
      if (err instanceof GitSyncInterruptedError) {
        return res.status(409).json({ key: 'github_sync_interrupted' })
      }
      if ([
        'github_sync_diverged_conflict',
        'github_sync_linked_branch_moved',
        'github_sync_merge_recovery_branch',
      ].includes(info?.key)) {
        return res.status(errStatus).json({
          key: info.key,
          translationOptions: info.translationOptions,
        })
      }
      return res.status(errStatus).json({ message: err.message })
    }
  }

  // Unlink user's Git server account
  async function unlinkRepo(req, res) {
    const { project_id: projectId } = req.params
    const userId = SessionManager.getLoggedInUserId(req.session)
    try {
      const ownerEmail = await GitSyncHandler.unlinkRepo(userId, projectId)
      if (ownerEmail) return res.status(403).json({ ownerEmail })
    } catch (err) {
      const info = OError.getFullInfo(err)
      const errStatus = info?.status || 500
      logger.error(OError.getFullStack(err))
      logger.error({ info, projectId }, 'Error unlinking repo from project')
      return res.status(errStatus).json({ message: err.message })
    }
    res.sendStatus(200)
  }
  return {
    getConnectionStatus: expressify(getConnectionStatus),
    getProjectState: expressify(getProjectState),
    oauth2: expressify(oauth2),
    unlink: expressify(unlink),
    getUserAndOrgs: expressify(getUserAndOrgs),
    oauth2Callback: expressify(oauth2Callback),
    listUserRepos: expressify(listUserRepos),
    listRepoBranches: expressify(listRepoBranches),
    importRepo: expressify(importRepo),
    exportProject: expressify(exportProject),
    getMergeOverview: expressify(getMergeOverview),
    gitMerge: expressify(gitMerge),
    unlinkRepo: expressify(unlinkRepo),
  }
}
