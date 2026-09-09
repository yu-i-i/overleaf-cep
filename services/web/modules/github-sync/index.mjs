import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let GitHubSyncModule = {}
if (process.env.GITHUB_SYNC_ENABLED?.toLowerCase() === 'true' || 
    process.env.GIT_SYNC_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling Git Sync module')

  const [{ default: GitHubSyncRouter },
         { default: SyncStateManager },
         { default: TokenManager }
        ] =
    await Promise.all([
      import('./app/src/GitHubSyncRouter.mjs'),
      import('./app/src/SyncStateManager.mjs'),
      import('./app/src/TokenManager.mjs')
    ])

  // Get server URL from environment or use default
  const siteUrl = Settings.siteUrl.replace(/\/+$/, '') || 'http://localhost'
  
  // Initialize default gitSync settings (for backward compatibility)
  const serverUrl = process.env.GITHUB_SYNC_SERVER_URL ||
                    process.env.GIT_SYNC_SERVER_URL ||
                    'https://github.com'

  Settings.githubSync = {
    enabled: true,
    serverUrl: serverUrl.replace(/\/$/, ''),
    clientID: process.env.GITHUB_SYNC_CLIENT_ID || process.env.GIT_SYNC_CLIENT_ID,
    clientSecret: process.env.GITHUB_SYNC_CLIENT_SECRET || process.env.GIT_SYNC_CLIENT_SECRET,
    callbackURL: `${siteUrl}/user/github-sync/oauth2/callback`,
  }

  // Delete project sync state from mongo (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await SyncStateManager.removeProjectState(projectId)
      logger.debug({ projectId }, 'on project expire: removed Git sync state')
    } catch (err) {
      logger.warn({ projectId, err }, 'on project expire: failed to remove Git sync state')
    }
  })

  // Delete user github token + any project states they created (hook 'expireDeletedUser')
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      await TokenManager.removeUserToken(userId)
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user token')
    }
    try {
      await SyncStateManager.removeProjectStatesByOwnerId(userId)
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing project sync states')
    }
  })

  GitHubSyncModule = {
    router: GitHubSyncRouter,
  }
}

export default GitHubSyncModule
