import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import GitBridgeController from './GitBridgeController.mjs'
import ensureTokenProjectAccess from './GitBridgeAuthMiddleware.mjs'
import GitBridgePATController from './GitBridgePATController.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'

const oauthTokenInfoRateLimiter = new RateLimiter('oauth-token-info', {
  points: 30,
  duration: 60,
})

export default {
  apply(webRouter, privateApiRouter, publicApiRouter) {
    logger.debug({}, 'Init git-bridge router')

// Called by git-bridge served by web-api
    privateApiRouter.get('/api/v0/docs/:project_id',
      ensureTokenProjectAccess('read'),
      GitBridgeController.getDoc
    )
    privateApiRouter.get(
      '/api/v0/docs/:project_id/saved_vers',
      ensureTokenProjectAccess('read'),
      GitBridgeController.getSavedVers
    )
    privateApiRouter.get(
      '/api/v0/docs/:project_id/snapshots/:version',
      ensureTokenProjectAccess('read'),
      GitBridgeController.getSnapshot
    )
    privateApiRouter.post(
      '/api/v0/docs/:project_id/snapshots',
      ensureTokenProjectAccess('write'),
      GitBridgeController.postSnapshot
    )
// Called by git-bridge to validate a PAT, served by web
    publicApiRouter.get('/oauth/token/info',
      RateLimiterMiddleware.rateLimit(oauthTokenInfoRateLimiter),
      GitBridgePATController.validatePersonalAccessToken
    )
    webRouter.get('/git-bridge/personal-access-tokens',
      AuthenticationController.requireLogin(),
      GitBridgePATController.getUserPersonalAccessTokens
    )
    webRouter.post('/git-bridge/personal-access-tokens',
      AuthenticationController.requireLogin(),
      GitBridgePATController.createPersonalAccessToken
    )
    webRouter.delete('/git-bridge/personal-access-tokens/:token_id',
      AuthenticationController.requireLogin(),
      GitBridgePATController.deletePersonalAccessToken
    )
  }
}
