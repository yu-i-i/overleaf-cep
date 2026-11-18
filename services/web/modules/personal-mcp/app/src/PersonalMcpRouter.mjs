import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import PersonalMcpTokensController from './PersonalMcpTokensController.mjs'
import PersonalMcpTokenManager from './PersonalMcpTokenManager.mjs'
import PersonalMcpReadService from './PersonalMcpOverleafReadService.mjs'
import { createDispatcher, createMcpMiddleware } from './PersonalMcpServer.mjs'

const mcpRateLimiter = new RateLimiter('personal-mcp', {
  points: 120,
  duration: 60,
})

// Bearer auth parsed the same way as the git-bridge PAT validation. The
// authenticated userId is stored on req.user_id (never req.user) and only
// from here on does any tool logic run.
async function requirePersonalMcpToken(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.trim().split(/\s+/, 2)
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    Metrics.inc('security.mcp.auth', 1, { status: 'reject' })
    return res.set('WWW-Authenticate', 'Bearer').sendStatus(401)
  }
  let identity
  try {
    identity = await PersonalMcpTokenManager.authenticateToken(token)
  } catch (err) {
    logger.error({ err }, 'personal-mcp: token authentication errored')
    return res.status(500).json({ error: 'internal_error' })
  }
  if (!identity) {
    Metrics.inc('security.mcp.auth', 1, { status: 'reject' })
    return res.set('WWW-Authenticate', 'Bearer').sendStatus(401)
  }
  Metrics.inc('security.mcp.auth', 1, { status: 'accept' })
  req.user_id = identity.userId
  req.personal_mcp_token_id = identity.tokenId
  return next()
}

const handleMcp = createMcpMiddleware(
  createDispatcher({ readService: PersonalMcpReadService })
)

function methodNotAllowed(req, res) {
  return res.set('Allow', 'POST').sendStatus(405)
}

export default {
  apply(webRouter, privateApiRouter, publicApiRouter) {
    // Token management: session + CSRF (webRouter), like git-bridge PATs.
    webRouter.get(
      '/personal-mcp/tokens',
      AuthenticationController.requireLogin(),
      PersonalMcpTokensController.getTokens
    )
    webRouter.post(
      '/personal-mcp/tokens',
      AuthenticationController.requireLogin(),
      PersonalMcpTokensController.createToken
    )
    webRouter.delete(
      '/personal-mcp/tokens/:token_id',
      AuthenticationController.requireLogin(),
      PersonalMcpTokensController.deleteToken
    )

    // MCP endpoint: Bearer tokens only. publicApiRouter carries no session,
    // no CSRF and is not behind requireGlobalLogin.
    publicApiRouter.post(
      '/mcp',
      RateLimiterMiddleware.rateLimit(mcpRateLimiter),
      requirePersonalMcpToken,
      handleMcp
    )
    publicApiRouter.get('/mcp', methodNotAllowed)
    publicApiRouter.delete('/mcp', methodNotAllowed)
  },
}
