import Modules from '../../../../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

import createSyncStateManager from './SyncStateManager.mjs'
import createTokenManager from './TokenManager.mjs'
import createGitSyncHandler from './GitSyncHandler.mjs'
import createGitSyncController from './GitSyncController.mjs'
import createGitSyncRouter from './GitSyncRouter.mjs'

export default async function createGitSyncModule({ provider, api, ProjectStates, doGitMerge }) {
  const SyncStateManager = createSyncStateManager(ProjectStates, provider)
  const TokenManager = createTokenManager(provider, api)
  const GitSyncHandler = createGitSyncHandler({ api, SyncStateManager, TokenManager, provider })
  const controller = createGitSyncController({ api, GitSyncHandler, TokenManager, doGitMerge, provider })

  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await SyncStateManager.removeProjectState(projectId)
    } catch (err) {
      logger.warn({ projectId, provider, err }, 'failed to remove Git sync state')
    }
  })

  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      await TokenManager.removeUserToken(userId)
    } catch (err) {
      logger.warn({ userId, provider, err }, 'failed to remove Git sync token')
    }
  })

  return {
    router: createGitSyncRouter(provider, controller),
  }
}
