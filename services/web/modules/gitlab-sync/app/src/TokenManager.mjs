import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { GitLabSyncUserCredentials } from '../models/gitlabSyncUserCredentials.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'
import api from './GitLabApiClient.mjs'

const { normalizeQuery } = Mongo

async function encryptAccessToken(accessToken) {
  try {
    return await AccessTokenEncryptor.encryptJson(accessToken)
  } catch (err) {
    throw OError.tag('failed to encrypt token', err)
  }
}

async function decryptAccessToken(tokenEncrypted) {
  try {
    return await AccessTokenEncryptor.decryptToJson(tokenEncrypted)
  } catch (err) {
    throw new InvalidTokenError('failed to decrypt token', { status: 401 }, err)
  }
}

async function refreshToken(userId, decData) {
  logger.info({ userId }, "refreshing GitLab token")

  if (!decData.refresh_token) {
    logger.error("refresh_token invalid")
    return false
  }

  let token
  let refresh_token
  let refresh_timestamp

  try {
    [token, refresh_token, refresh_timestamp] = await api.refreshToken(decData.refresh_token)
    if (!token || !refresh_token) {
      HttpErrorHandler.badRequest(req, res, 'Failed to refresh access token')
      return false
    }
  } catch (err) {
    const info = OError.getFullInfo(err)
    logger.error(OError.getFullStack(err))
    logger.error({ info, userId }, 'Failed to refresh access token')
    HttpErrorHandler.badRequest(req, res, err.message || 'Bad request')
    return false
  }

  try {
    await saveUserToken(userId, { token, refresh_token, refresh_timestamp })
  } catch (err) {
    const info = OError.getFullInfo(err)
    const errStatus = info?.status || 500
    logger.error(OError.getFullStack(err))
    logger.error({ info, userId }, 'Error saving user token')
    HttpErrorHandler.handleErrorByStatusCode(req, res, err, errStatus)
    return false
  }

  return true
}

// ------------------------- exports -------------------------- //
async function getUserToken(userId) {
  const credentials = await GitLabSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) throw new InvalidTokenError('no user token', { userId, status: 400 })
  let decData = await decryptAccessToken(credentials.gitlab)

  const now = Math.floor(Date.now() / 1000);
  if (!decData.refresh_timestamp || decData.refresh_timestamp < now) {
    const refreshed = await refreshToken(userId, decData)
    if (refreshed) {
      return await getUserToken(userId)
    }
  }

  return decData.token
}

async function saveUserToken(userId, accessToken) {
  const tokenEncrypted = await encryptAccessToken(accessToken)
  await GitLabSyncUserCredentials.findOneAndUpdate(
    normalizeQuery({ userId }),
    { $set: { gitlab: tokenEncrypted } },
    { upsert: true }
  )
}

// Try to revoke user's token, then remove it
async function removeUserToken(userId) {
  let token
  try {
    token = await getUserToken(userId)
  } catch (err) {
    logger.warn({ err, userId }, 'failed to get user token')
  }
  // fire-and-forget, but still handle errors
  if (token) {
      api.revokeToken(token).catch(err => {
      logger.warn({ err, userId }, 'failed to revoke user token')
    })
  }
  await GitLabSyncUserCredentials.deleteOne(normalizeQuery({ userId }))
  return
}

export default {
  saveUserToken,
  getUserToken,
  removeUserToken
}
