import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import GitBridgePATManager from './GitBridgePATManager.mjs'

const MAX_PAT_COUNT = 10

async function _sendSecurityAlertCreatedPAT(user) {
  const emailOptions = {
    to: user.email,
    actionDescribed: `a new Git authentication token has been generated for your account ${user.email}`,
    action: 'new Git authentication token generated',
  }
  try {
    await EmailHandler.promises.sendEmail('securityAlert', emailOptions)
  } catch (error) {
    // log error when sending security alert email but do not pass back
    logger.error(
      { error, userId: user._id },
      'could not send security alert new Git authentication token generated'
    )
  }
}

const GitBridgePATController = {
  async getUserPersonalAccessTokens(req, res) {
    const user = SessionManager.getSessionUser(req.session)
    if (!user) return res.sendStatus(401)

    try {
      const userId = user._id
      const tokens = 
        await GitBridgePATManager.getTokens(userId)
      return res.json(tokens)
    } catch (err) {
      logger.error({ err, userId }, 'Failed to get personal access tokens')
      return res.sendStatus(500)
    }
  },

  async createPersonalAccessToken(req, res){
    const user = SessionManager.getSessionUser(req.session)
    if (!user) return res.sendStatus(401)

    try {
      const count = await GitBridgePATManager.countTokens(user._id)
      if (count >= MAX_PAT_COUNT) return res.sendStatus(403)

      const token = await GitBridgePATManager.createToken(user._id)

      // no need to wait, errors are logged and not passed back
      _sendSecurityAlertCreatedPAT(user)

      return res.json(token)

    } catch (err) {
      logger.error({ err }, 'Error in PAR create')
      return res.sendStatus(500)
    }
  },

  async deletePersonalAccessToken(req, res){
    const user = SessionManager.getSessionUser(req.session)
    if (!user) return res.sendStatus(401)
    const userId = user._id

    const tokenId = req.params?.token_id
    if (!tokenId) return res.sendStatus(400)

    try {
      const deleted = await GitBridgePATManager.deleteToken(tokenId, userId)
      if (!deleted) return res.sendStatus(404)

      return res.sendStatus(200)
    } catch (err) {
      logger.error({ err, userId, tokenId }, 'Error in PAT delete')
      return res.sendStatus(500)
    }
  },

  async validatePersonalAccessToken(req, res) {
    const header = req.headers.authorization || ''
    const [scheme, token] = header.trim().split(/\s+/, 2)
    if (scheme?.toLowerCase() !== 'bearer' || !token) return res.sendStatus(401)

    try {
      const userId = await GitBridgePATManager.getUserId(token)
      if (!userId) return res.sendStatus(401)

      return res.sendStatus(200)
    } catch (err) {
      logger.error({ err }, 'Error in PAT validate')
      return res.sendStatus(500)
    }
  },
}

export default GitBridgePATController
