import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let GitLabSyncModule = {}
if (process.env.GITLAB_SYNC_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling GitLab Sync module')

  // The GITLAB_URL variable has to be set for this module to work, otherwise the module will not be enabled
  if (!process.env.GITLAB_SYNC_URL || !process.env.GITLAB_SYNC_CLIENT_ID || !process.env.GITLAB_SYNC_CLIENT_SECRET) {
    logger.warn({}, 'GitLab Sync module is enabled but not all mandatory envirionment variables are set, stopping module initialization')
  } else {
    const siteUrl = Settings.siteUrl.replace(/\/+$/, '') || 'http://localhost'
    Settings.gitlabSync = {
      url: process.env.GITLAB_SYNC_URL.replace(/\/+$/, ''),
      clientID: process.env.GITLAB_SYNC_CLIENT_ID,
      clientSecret: process.env.GITLAB_SYNC_CLIENT_SECRET,
      callbackURL: `${siteUrl}/user/gitlab-sync/oauth2/callback`,
      defaultBranch: process.env.GITLAB_DEFAULT_BRANCH || 'main',
      mergeRequestPollInterval: process.env.GITLAB_MERGE_REQUEST_POLL_INTERVAL_MS || 1000,
      mergeRequestTimeout: process.env.GITLAB_MERGE_REQUEST_TIMEOUT_MS || 60_000,
    }

    const [{ default: GitLabSyncRouter },
           { default: SyncStateManager },
           { default: TokenManager }
          ] =
      await Promise.all([
        import('./app/src/GitLabSyncRouter.mjs'),
        import('./app/src/SyncStateManager.mjs'),
        import('./app/src/TokenManager.mjs'),
      ])
  
    // Delete project sync state from mongo (hook 'projectExpired')
    Modules.hooks.attach('projectExpired', async projectId => {
      try {
        await SyncStateManager.removeProjectState(projectId)
        logger.debug({ projectId }, 'on project expire: removed Git sync state')
      } catch (err) {
        logger.warn({ projectId, err }, 'on project expire: failed to remove Git sync state')
      }
    })
  
    // Delete user gitlab token from mongo (hook 'expireDeletedUser')
    Modules.hooks.attach('expireDeletedUser', async userId => {
      try {
        await TokenManager.removeUserToken(userId)
      } catch (err) {
        logger.warn({ userId, err }, 'on user expire: failed removing user token')
      }
    })
  
    GitLabSyncModule = {
      router: GitLabSyncRouter,
    }
  }
}

export default GitLabSyncModule
