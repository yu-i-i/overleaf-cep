import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import crypto from 'crypto'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import ZoteroOAuth from './ZoteroOAuth.mjs'
import TokenManager from './TokenManager.mjs'

async function oauth(req, res) {
  try {
    const requestToken = await ZoteroOAuth.getRequestToken()
    const isPopup = req.query.popup === '1'

    req.session.zoteroOAuth = {
      token: requestToken.oauth_token,
      tokenSecret: requestToken.oauth_token_secret,
      isPopup
    }

    const authUrl = ZoteroOAuth.getAuthorizationUrl(requestToken.oauth_token)
    res.redirect(authUrl)

  } catch (err) {
    logger.error(OError.getFullStack(err))
    const info = OError.getFullInfo(err)
    logger.error({ info }, "Failed to start Zotero authorization")

    HttpErrorHandler.badRequest(req, res, 'Failed to start Zotero authorization')
    return
  }
}

async function oauthCallback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  const {
    oauth_token: oauthToken,
    oauth_verifier: oauthVerifier,
  } = req.query

  const saved = req.session.zoteroOAuth
  delete req.session.zoteroOAuth

  if (!saved || saved.token !== oauthToken) {
    HttpErrorHandler.forbidden(req, res, 'Invalid OAuth token')
    return
  }

  try {
    const { accessToken, zoteroUserId } = await ZoteroOAuth.exchangeRequestTokenForAccessToken(
      oauthToken,
      saved.tokenSecret,
      oauthVerifier,
    )
    await TokenManager.storeCredentials(userId, accessToken, zoteroUserId)

  } catch (err) {
    logger.error(OError.getFullStack(err))
    const info = OError.getFullInfo(err)
    logger.error({ info }, "Failed to obtain Zotero access token'")

    HttpErrorHandler.badRequest(req, res, 'Failed to obtain Zotero access token')
    return
  }

  const nonce = crypto.randomBytes(16).toString('base64')
  const csp = res.getHeader('Content-Security-Policy')

  res.setHeader(
    'Content-Security-Policy',
    `${csp}; script-src 'nonce-${nonce}'`
  )

  res.send(`
    <!doctype html>
    <html>
      <body>
        <script nonce="${nonce}">
          const channel = new BroadcastChannel('zotero')
          channel.postMessage({ type: 'zotero-linked' })
          ${saved.isPopup
            ? 'window.close()'
            : "location.href = '/user/settings#references'"
          }
        </script>
      </body>
    </html>
  `)
}

/**
 * GET /user/zotero/status
 * Returns the user's Zotero connection status, true or false
 */
async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const isConnected = await ZoteroApiClient.getConnectionStatus(userId)
    res.json(isConnected)

  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed to check user connection")
    return res.status(errStatus).json({ message: err.message })
  }
}

/**
 * GET /user/zotero/groups
 * Returns the user's Zotero groups or null, if account is not linked
 */
async function getGroups(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const groups = await ZoteroApiClient.getGroupsForUser(userId)
    res.json(groups)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "failed to get user groups")
    return res.status(errStatus).json({ message: err.message })
  }
}

/**
 * DELETE /user/zotero/unlink
 * Unlinks the user's Zotero account.
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await ZoteroApiClient.unlinkAccount(userId)
    res.sendStatus(200)
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info }, "error unlinking Zotero account")
    return res.status(errStatus).json({ message: err.message })
  }
}

export default {
  oauth,
  oauthCallback,
  getConnectionStatus,
  getGroups,
  unlink
}
