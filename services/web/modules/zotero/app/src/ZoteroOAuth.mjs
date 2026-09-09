import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { fetchString } from '@overleaf/fetch-utils'
import OAuth from 'oauth-1.0a'
import crypto from 'crypto'

const ZOTERO_OAUTH_URL = 'https://www.zotero.org/oauth'

function hashFunctionSha1(baseString, key) {
  return crypto.createHmac('sha1', key)
    .update(baseString)
    .digest('base64')
}

/**
 * R6 (2026-08-29): resolve the Zotero app credentials per request.
 * P3c moved them into site_settings (clientSecret stored encrypted); the
 * live server has NO ZOTERO_* env vars, so Settings.zotero is undefined
 * and the old code (Settings.zotero.clientKey) crashed with a TypeError.
 * Resolution: site_settings first (secret decrypted by the manager),
 * env/Settings second (legacy CE setups).
 */
async function getCredentials() {
  try {
    const SiteSettingsManager = await import(
      '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
    )
    const section = await SiteSettingsManager.getSection('zotero', Settings)
    const clientKey = String(section?.clientKey || '').trim()
    const clientSecret = String(section?.clientSecret || '').trim()
    if (clientKey && clientSecret) {
      return { clientKey, clientSecret }
    }
  } catch (err) {
    logger.warn({ err }, 'ZoteroOAuth: site_settings lookup failed; falling back to env')
  }
  const clientKey = String(Settings.zotero?.clientKey || process.env.ZOTERO_CLIENT_KEY || '').trim()
  const clientSecret = String(
    Settings.zotero?.clientSecret || process.env.ZOTERO_CLIENT_SECRET || ''
  ).trim()
  if (!clientKey || !clientSecret) {
    throw new OError(
      'Zotero is enabled but its app credentials are not configured (site_settings section "zotero" is missing clientKey/clientSecret) — see Manage Site',
      { status: 500 }
    )
  }
  return { clientKey, clientSecret }
}

function createOAuthClient(credentials) {
  return OAuth({
    consumer: {
      key: credentials.clientKey,
      secret: credentials.clientSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function: hashFunctionSha1,
  })
}

function buildAuthorizationHeader(requestData, tokenData, credentials) {
  const oauth = createOAuthClient(credentials)
  const authData = oauth.authorize(requestData, tokenData)

  return oauth.toHeader(authData).Authorization
}

function parseOAuthResponse(body) {
  return Object.fromEntries(new URLSearchParams(body).entries())
}

function getAuthorizationUrl(oauthToken) {
  const params = new URLSearchParams({
    oauth_token: oauthToken,
    library_access: '1',
    all_groups: 'read',
  })

  return `${ZOTERO_OAUTH_URL}/authorize?${params}`
}
/*
function getAuthorizationUrl(oauthToken) {
  return `${ZOTERO_OAUTH_URL}/authorize?oauth_token=${oauthToken}`
}
*/

async function getRequestToken({ credentials, callbackURL }) {
  const url = `${ZOTERO_OAUTH_URL}/request`

  try {
    const body = await fetchString(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthorizationHeader(
          {
            url,
            method: 'POST',
            data: {
              oauth_callback: callbackURL,
            },
          },
          undefined,
          credentials
        ),
      },
    })

    return parseOAuthResponse(body)
  } catch (err) {
    throw OError.tag(err, 'error obtaining Zotero request token')
  }
}

async function exchangeRequestTokenForAccessToken(
  oauthToken,
  oauthTokenSecret,
  oauthVerifier,
  credentials,
) {
  const url = `${ZOTERO_OAUTH_URL}/access`

  try {
    const body = await fetchString(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthorizationHeader(
          {
            url,
            method: 'POST',
            data: {
              oauth_verifier: oauthVerifier,
            },
          },
          {
            key: oauthToken,
            secret: oauthTokenSecret,
          },
          credentials
        ),
      },
    })

    const data = parseOAuthResponse(body)

    return {
      accessToken: data.oauth_token,
      apiKeySecret: data.oauth_token_secret,
      zoteroUserId: data.userID,
      username: data.username,
    }
  } catch (err) {
    logger.err(
      { err, oauthToken },
      'error obtaining Zotero access token'
    )

    throw OError.tag(err, 'error obtaining Zotero access token')
  }
}

export default {
  getCredentials,
  getAuthorizationUrl,
  getRequestToken,
  exchangeRequestTokenForAccessToken,
}
