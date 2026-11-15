import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Mongo from '../../../../../app/src/Features/Helpers/Mongo.mjs'
import { GitSyncUserCredentials } from '../models/gitSyncUserCredentials.mjs'
import LockManager from '../../../../../app/src/infrastructure/LockManager.mjs'
import createAccessTokenEncryptor from './AccessTokenEncryptorHelper.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'

const { normalizeQuery } = Mongo
const TokenRefreshLockManager = LockManager.withTimeout(120)

export default function createTokenManager(provider, api) {
  const AccessTokenEncryptor = createAccessTokenEncryptor(provider)

  async function getStoredToken(userId) {
    const credentials = await GitSyncUserCredentials.findOne(normalizeQuery({ userId }))
    if (!credentials?.[provider]) throw new InvalidTokenError('no user token', { userId, status: 400 })
    try {
      return await AccessTokenEncryptor.decryptToJson(credentials[provider])
    } catch (err) {
      throw new InvalidTokenError('failed to decrypt token', { userId, status: 401 }, err)
    }
  }

  function validCredentials(credentials) {
    const token = credentials?.token
    return typeof token === 'string' && token.length > 0 && (!api.refreshToken ||
      (typeof credentials.refresh_token === 'string' && credentials.refresh_token.length > 0 &&
        Number.isFinite(credentials.refresh_timestamp) && credentials.refresh_timestamp > 0))
  }

  async function exchangeCodeForToken(code) {
    const credentials = await api.exchangeCodeForToken(code)
    if (!validCredentials(credentials)) {
      throw new InvalidTokenError('Failed to obtain access token from Git server', { status: 400 })
    }
    return credentials
  }

  function saveUserToken(userId, credentials) {
    return TokenRefreshLockManager.promises.runWithLock(
      'gitSyncTokenRefresh', `${provider}:${userId}`,
      () => saveUserTokenWithoutLock(userId, credentials)
    )
  }

  async function saveUserTokenWithoutLock(userId, credentials) {
    let previousToken
    if (api.revokeReplacedToken) {
      try {
        previousToken = (await getStoredToken(userId)).token
      } catch (err) {
        if (!(err instanceof InvalidTokenError)) throw err
      }
    }
    let encrypted
    try {
      encrypted = await AccessTokenEncryptor.encryptJson(credentials)
    } catch (err) {
      throw OError.tag(err, 'failed to encrypt token')
    }
    await GitSyncUserCredentials.findOneAndUpdate(
      normalizeQuery({ userId }),
      { $set: { [provider]: encrypted } },
      { upsert: true }
    )
    if (previousToken && previousToken !== credentials.token) {
      api.revokeReplacedToken(previousToken).catch(err => {
        logger.warn({ err, userId, provider }, 'failed to revoke replaced user token')
      })
    }
  }

  async function getUserToken(userId) {
    const data = await getStoredToken(userId)
    if (!api.refreshToken || data.refresh_timestamp > Math.floor(Date.now() / 1000)) {
      return data.token
    }
    if (!data.refresh_token) {
      throw new InvalidTokenError('missing Git provider refresh token', { userId, status: 401 })
    }
    return TokenRefreshLockManager.promises.runWithLock(
      'gitSyncTokenRefresh',
      `${provider}:${userId}`,
      async () => {
        const current = await getStoredToken(userId)
        if (current.refresh_timestamp && current.refresh_timestamp > Math.floor(Date.now() / 1000)) {
          return current.token
        }
        if (!current.refresh_token) {
          throw new InvalidTokenError('missing Git provider refresh token', { userId, status: 401 })
        }
        const credentials = await api.refreshToken(current.refresh_token)
        if (!validCredentials(credentials)) {
          throw new InvalidTokenError('failed to refresh Git provider token', { userId, status: 401 })
        }
        await saveUserTokenWithoutLock(userId, credentials)
        return credentials.token
      }
    )
  }

  function removeUserToken(userId) {
    return TokenRefreshLockManager.promises.runWithLock(
      'gitSyncTokenRefresh', `${provider}:${userId}`,
      () => removeUserTokenWithoutLock(userId)
    )
  }

  async function removeUserTokenWithoutLock(userId) {
    let token
    try {
      const stored = await getStoredToken(userId)
      token = stored.token
    } catch (err) {
      logger.warn({ err, userId, provider }, 'failed to get user token')
    }
    await GitSyncUserCredentials.updateOne(
      normalizeQuery({ userId }),
      { $unset: { [provider]: '' } }
    )
    await GitSyncUserCredentials.deleteOne(normalizeQuery({
      userId,
      github: { $exists: false },
      gitlab: { $exists: false },
      gitea: { $exists: false },
    }))
    if (token) {
      api.revokeToken(token).catch(err => {
        logger.warn({ err, userId, provider }, 'failed to revoke user token')
      })
    }
  }

  return { exchangeCodeForToken, getUserToken, saveUserToken, removeUserToken }
}
