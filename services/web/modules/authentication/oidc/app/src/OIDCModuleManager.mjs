import logger from '@overleaf/logger'
import passport from 'passport'
import Settings from '@overleaf/settings'
import { readFilesContentFromEnv, numFromEnv, boolFromEnv } from '../../../utils.mjs'
import PermissionsManager from '../../../../../app/src/Features/Authorization/PermissionsManager.js'
import OIDCAuthenticationController from './OIDCAuthenticationController.mjs'
import { Strategy as OIDCStrategy } from 'passport-openidconnect'

const OIDCModuleManager = {
  initSettings() {
    let providerId = process.env.OVERLEAF_OIDC_PROVIDER_ID || 'oidc'
    Settings.oidc = {
      enable: true,
      providerId:   providerId,
      identityServiceName: process.env.OVERLEAF_OIDC_IDENTITY_SERVICE_NAME || `Log in with ${Settings.oauthProviders[providerId].name}`,
      attUserId:    process.env.OVERLEAF_OIDC_USER_ID_FIELD || 'id',
      attAdmin:     process.env.OVERLEAF_OIDC_IS_ADMIN_FIELD,
      valAdmin:     process.env.OVERLEAF_OIDC_IS_ADMIN_FIELD_VALUE,
      updateUserDetailsOnLogin: boolFromEnv(process.env.OVERLEAF_OIDC_UPDATE_USER_DETAILS_ON_LOGIN),
    }
  },
  passportSetup(passport, callback) {
    const oidcOptions = {
      issuer: process.env.OVERLEAF_OIDC_ISSUER,
      authorizationURL: process.env.OVERLEAF_OIDC_AUTHORIZATION_URL,
      tokenURL: process.env.OVERLEAF_OIDC_TOKEN_URL,
      userInfoURL: process.env.OVERLEAF_OIDC_USER_INFO_URL,
      clientID: process.env.OVERLEAF_OIDC_CLIENT_ID,
      clientSecret: process.env.OVERLEAF_OIDC_CLIENT_SECRET,
      callbackURL: `${Settings.siteUrl.replace(/\/+$/, '')}/oidc/login/callback`,
      scope: process.env.OVERLEAF_OIDC_SCOPE || 'openid profile email',
      passReqToCallback: true,
    }
    try {
      passport.use(
        new OIDCStrategy(
          oidcOptions,
          OIDCAuthenticationController.doPassportLogin
        )
      )
      callback(null)
    } catch (error) {
      callback(error)
    }
  },
  initPolicy() {
    try {
      PermissionsManager.registerCapability('change-password', { default : true })
    } catch (error) {
      logger.info({}, error.message)
    }
    const oidcPolicyValidator = async ({ user, subscription }) => {
// If user is not logged in, user.externalAuth is undefined,
// in this case allow to change password if the user has a hashedPassword
      return user.externalAuth === 'oidc' || (user.externalAuth === undefined && !user.hashedPassword)
    }
    try {
    PermissionsManager.registerPolicy(
      'oidcPolicy',
      { 'change-password' : false },
      { validator: oidcPolicyValidator }
    )
    } catch (error) {
      logger.info({}, error.message)
    }
  },
  async getGroupPolicyForUser(user, callback) {
    try {
      const userValidationMap = await PermissionsManager.promises.getUserValidationStatus({
        user,
        groupPolicy : { 'oidcPolicy' : true },
        subscription : null
      })
      let groupPolicy = Object.fromEntries(userValidationMap)
      callback(null,  {'groupPolicy' : groupPolicy })
    } catch (error) {
      callback(error)
    }
  },
}

export default OIDCModuleManager
