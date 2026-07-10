import crypto from 'node:crypto'
import settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import OneTimeTokenHandler from '../../../../app/src/Features/Security/OneTimeTokenHandler.mjs'

const ONE_WEEK = 7 * 24 * 60 * 60 // seconds

export default async function registerNewUserAndSendActivationEmail(userData) {
  let user
  try {
    const password = crypto.randomBytes(32).toString('hex')
    user = await UserRegistrationHandler.promises.registerNewUser({ ...userData, password })
  } catch (error) {
    if (error.message === 'EmailAlreadyRegistered') {
      logger.debug({ email: userData.email }, 'user already registered')
      return false
    }
    throw error
  }

  try {
    const token = await OneTimeTokenHandler.promises.getNewToken(
      'password',
      { user_id: user._id.toString(), email: user.email },
      { expiresIn: ONE_WEEK }
    )

    const setNewPasswordUrl = `${settings.siteUrl}/user/activate?token=${token}&user_id=${user._id}`

    await EmailHandler.promises.sendEmail('registered', {
      to: user.email,
      setNewPasswordUrl,
    })
  } catch (error) {
    try {
      await UserDeleter.promises.deleteUser(user._id, {
        ipAddress: '127.0.0.1',
        skipEmail: true,
      })
      await UserDeleter.promises.expireDeletedUser(user._id)
    } catch (err) {
      logger.error({ err, userId: user._id },  'failed delete user')
    }
    throw error
  }

  return true
}
