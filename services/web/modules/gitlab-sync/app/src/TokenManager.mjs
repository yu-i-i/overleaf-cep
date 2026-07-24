import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { GitLabSyncUserCredentials } from '../models/gitlabSyncUserCredentials.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'

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

// ------------------------- exports -------------------------- //
async function getUserToken(userId) {
  const credentials = await GitLabSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) throw new InvalidTokenError('no user token', { userId, status: 400 })
  return await decryptAccessToken(credentials.gitlab)
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
    GitLabApiClient.revokeToken(token).catch(err => {
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
