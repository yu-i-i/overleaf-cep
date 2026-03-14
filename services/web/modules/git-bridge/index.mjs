import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { db } from '../../app/src/infrastructure/mongodb.mjs'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import GitBridgeRouter from './app/src/GitBridgeRouter.mjs'

let GitBridgeModule = {}

if (process.env.GIT_BRIDGE_ENABLED === 'true') {
  logger.debug({}, 'Enabling git-bridge module')

  Settings.enableGitBridge = true

  // Delete all user's git-bridge tokens on user expire (hook 'expireDeletedUser')
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      const query = {
        user_id: userId,
        scope: /\bgit_bridge\b/,
        type: 'personal_access_token'
      }
      await db.oauthAccessTokens.deleteMany(query)
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed deleting git-bridge tokens')
    }
  })
  // Delete project from /data/git-bridge on project expire (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    const gitBridgeApiBaseUrl = process.env.GIT_BRIDGE_API_BASE_URL ||
      `http://${process.env.GIT_BRIDGE_HOST || 'git-bridge'}:${
        process.env.GIT_BRIDGE_PORT || '8000'
      }/api`
    try {
      const res = await fetch(`${gitBridgeApiBaseUrl}/projects/${projectId}`, {
        method: 'DELETE',
      }) 
      if (!res.ok) throw new Error(`error status: ${res.status}`)

    } catch (err) {
      logger.warn({ projectId, err }, 'on project expire: failed deleting project in git-bridge')
    }
  })
  GitBridgeModule = {
    router: GitBridgeRouter,
  }
}

export default GitBridgeModule
