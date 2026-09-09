import logger from '@overleaf/logger'

import GitHubSyncController from './GitHubSyncController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init github-sync router')

    // start the GitHub OAuth flow by redirecting to GitHub authorization page
    webRouter.get(
      '/user/github-sync/oauth2',
      AuthenticationController.requireLogin(),
      GitHubSyncController.oauth2
    )

    // callback for GitHub OAuth flow
    webRouter.get(
      '/user/github-sync/oauth2/callback',
      AuthenticationController.requireLogin(),
      GitHubSyncController.oauth2Callback
    )

    // unlink GitHub account
    webRouter.post(
      '/user/github-sync/unlink',
      AuthenticationController.requireLogin(),
      GitHubSyncController.unlink
    )

    // get user git connection status
    webRouter.get(
      '/user/github-sync/status',
      AuthenticationController.requireLogin(),
      GitHubSyncController.getConnectionStatus
    )

    // Get user's configured Git servers (list)
    webRouter.get(
      '/user/git-servers',
      AuthenticationController.requireLogin(),
      GitHubSyncController.getUserServers
    )

    // Add new Git server configuration
    webRouter.post(
      '/user/git-servers',
      AuthenticationController.requireLogin(),
      GitHubSyncController.addServerConfig
    )

    // Remove a Git server configuration
    webRouter.delete(
      '/user/git-servers/:id',
      AuthenticationController.requireLogin(),
      GitHubSyncController.removeServerConfig
    )

    // PAT link endpoint (direct PAT input)
    webRouter.post(
      '/user/git-pat/link',
      AuthenticationController.requireLogin(),
      GitHubSyncController.linkPAT
    )

    // Test a saved git server connection
    webRouter.post(
      '/user/git-servers/test',
      AuthenticationController.requireLogin(),
      GitHubSyncController.testServer
    )

    // get git user name and user's organizations
    webRouter.get(
      '/user/github-sync/orgs',
      AuthenticationController.requireLogin(),
      GitHubSyncController.getUserAndOrgs
    )

    // list user's repos
    webRouter.get(
      '/user/github-sync/repos',
      AuthenticationController.requireLogin(),
      GitHubSyncController.listUserRepos
    )

    // create a new project from git server repo
    webRouter.post(
      '/project/new/github-sync',
      AuthenticationController.requireLogin(),
      GitHubSyncController.importRepo
    )

    // export project to git server
    webRouter.post(
      '/project/:project_id/github-sync/export',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitHubSyncController.exportProject
    )

    // get project sync state
    webRouter.get(
      '/project/:project_id/github-sync/state',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitHubSyncController.getProjectState
    )

    // get overview of the coming merge:
    // merge state (clean or diverged), unmerged commits, is OL version changed?
    webRouter.get(
      '/project/:project_id/github-sync/merge/overview',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitHubSyncController.getMergeOverview
    )

    // merge OL project with Git server repo
    webRouter.post(
      '/project/:project_id/github-sync/merge',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitHubSyncController.gitMerge
    )

    // unlink Git repo from Git server
    webRouter.delete(
      '/project/:project_id/github-sync',
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      GitHubSyncController.unlinkRepo
    )
  },
}
