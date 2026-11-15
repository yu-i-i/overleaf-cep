import logger from '@overleaf/logger'

import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

export default function createGitSyncRouter(provider, controller) {
  return {
    apply(webRouter) {
      logger.debug({ provider }, 'Init git-sync router')
      // start the provider OAuth flow
      webRouter.get(
        `/user/${provider}-sync/oauth2`,
        AuthenticationController.requireLogin(),
        controller.oauth2
      )

      // provider OAuth callback
      webRouter.get(
        `/user/${provider}-sync/oauth2/callback`,
        AuthenticationController.requireLogin(),
        controller.oauth2Callback
      )

      // unlink provider account
      webRouter.post(
        `/user/${provider}-sync/unlink`,
        AuthenticationController.requireLogin(),
        controller.unlink
      )

      // get user git connection status
      webRouter.get(
        `/user/${provider}-sync/status`,
        AuthenticationController.requireLogin(),
        controller.getConnectionStatus
      )

      // get git user name and user's organizations
      webRouter.get(
        `/user/${provider}-sync/orgs`,
        AuthenticationController.requireLogin(),
        controller.getUserAndOrgs
      )

      // list user's repos
      webRouter.get(
        `/user/${provider}-sync/repos`,
        AuthenticationController.requireLogin(),
        controller.listUserRepos
      )

      // list branches of a selected repository
      webRouter.get(
        `/user/${provider}-sync/repos/branches`,
        AuthenticationController.requireLogin(),
        controller.listRepoBranches
      )

      // create a new project from git server repo
      webRouter.post(
        `/project/new/${provider}-sync`,
        AuthenticationController.requireLogin(),
        controller.importRepo
      )

      // export project to git server
      webRouter.post(
        `/project/:project_id/${provider}-sync/export`,
        AuthenticationController.requireLogin(),
        AuthorizationMiddleware.ensureUserCanWriteProjectContent,
        controller.exportProject
      )

      // get project sync state
      webRouter.get(
        `/project/:project_id/${provider}-sync/state`,
        AuthenticationController.requireLogin(),
        AuthorizationMiddleware.ensureUserCanWriteProjectContent,
        controller.getProjectState
      )

      // get overview of the coming merge:
      // merge state (clean or diverged), unmerged commits, is OL version changed?
      webRouter.get(
        `/project/:project_id/${provider}-sync/merge/overview`,
        AuthenticationController.requireLogin(),
        AuthorizationMiddleware.ensureUserCanWriteProjectContent,
        controller.getMergeOverview
      )

      // merge OL project with Git server repo
      webRouter.post(
        `/project/:project_id/${provider}-sync/merge`,
        AuthenticationController.requireLogin(),
        AuthorizationMiddleware.ensureUserCanWriteProjectContent,
        controller.gitMerge
      )

      // unlink Git repo from Git server
      webRouter.delete(
        `/project/:project_id/${provider}-sync`,
        AuthenticationController.requireLogin(),
        AuthorizationMiddleware.ensureUserCanWriteProjectContent,
        controller.unlinkRepo
      )
    },
  }
}
