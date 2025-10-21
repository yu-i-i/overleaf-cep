import logger from '@overleaf/logger'
import passport from 'passport'
import Settings from '@overleaf/settings'
import { readFilesContentFromEnv, numFromEnv, boolFromEnv } from '../../../utils.mjs'
import PermissionsManager from '../../../../../app/src/Features/Authorization/PermissionsManager.js'
import SAMLAuthenticationController from './SAMLAuthenticationController.mjs'
import { Strategy as SAMLStrategy } from '@node-saml/passport-saml'

const SAMLModuleManager = {
  initSettings() {
  Settings.saml = {
    enable: true,
    identityServiceName: process.env.OVERLEAF_SAML_IDENTITY_SERVICE_NAME || 'Log in with SAML IdP',
    attUserId:    process.env.OVERLEAF_SAML_USER_ID_FIELD || 'nameID',
    attEmail:     process.env.OVERLEAF_SAML_EMAIL_FIELD || 'nameID',
    attFirstName: process.env.OVERLEAF_SAML_FIRST_NAME_FIELD || 'givenName',
    attLastName:  process.env.OVERLEAF_SAML_LAST_NAME_FIELD || 'lastName',
    attAdmin:     process.env.OVERLEAF_SAML_IS_ADMIN_FIELD,
    valAdmin:     process.env.OVERLEAF_SAML_IS_ADMIN_FIELD_VALUE,
    updateUserDetailsOnLogin: boolFromEnv(process.env.OVERLEAF_SAML_UPDATE_USER_DETAILS_ON_LOGIN),
  }
},
  passportSetup(passport, callback) {
    const samlOptions = {
      entryPoint: process.env.OVERLEAF_SAML_ENTRYPOINT,
      callbackUrl: `${Settings.siteUrl.replace(/\/+$/, '')}/saml/login/callback`,
      issuer: process.env.OVERLEAF_SAML_ISSUER,
      audience: process.env.OVERLEAF_SAML_AUDIENCE,
      cert: readFilesContentFromEnv(process.env.OVERLEAF_SAML_IDP_CERT),
      privateKey:  readFilesContentFromEnv(process.env.OVERLEAF_SAML_PRIVATE_KEY),
      decryptionPvk:  readFilesContentFromEnv(process.env.OVERLEAF_SAML_DECRYPTION_PVK),
      signatureAlgorithm: process.env.OVERLEAF_SAML_SIGNATURE_ALGORITHM,
      additionalParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_PARAMS || '{}'),
      additionalAuthorizeParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_AUTHORIZE_PARAMS || '{}'),
      identifierFormat: process.env.OVERLEAF_SAML_IDENTIFIER_FORMAT,
      acceptedClockSkewMs: numFromEnv(process.env.OVERLEAF_SAML_ACCEPTED_CLOCK_SKEW_MS),
      attributeConsumingServiceIndex: process.env.OVERLEAF_SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX,
      authnContext: process.env.OVERLEAF_SAML_AUTHN_CONTEXT ? JSON.parse(process.env.OVERLEAF_SAML_AUTHN_CONTEXT) : undefined,
      forceAuthn: boolFromEnv(process.env.OVERLEAF_SAML_FORCE_AUTHN),
      disableRequestedAuthnContext: boolFromEnv(process.env.OVERLEAF_SAML_DISABLE_REQUESTED_AUTHN_CONTEXT),
      skipRequestCompression: process.env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING === 'HTTP-POST',  // compression should be skipped iff authnRequestBinding is POST
      authnRequestBinding: process.env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING,
      validateInResponseTo: process.env.OVERLEAF_SAML_VALIDATE_IN_RESPONSE_TO,
      requestIdExpirationPeriodMs: numFromEnv(process.env.OVERLEAF_SAML_REQUEST_ID_EXPIRATION_PERIOD_MS),
      // cacheProvider: process.env.OVERLEAF_SAML_CACHE_PROVIDER,
      logoutUrl: process.env.OVERLEAF_SAML_LOGOUT_URL,
      logoutCallbackUrl: `${Settings.siteUrl.replace(/\/+$/, '')}/saml/logout/callback`,
      additionalLogoutParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_LOGOUT_PARAMS || '{}'),
      wantAssertionsSigned: boolFromEnv(process.env.OVERLEAF_SAML_WANT_ASSERTIONS_SIGNED),
      wantAuthnResponseSigned: boolFromEnv(process.env.OVERLEAF_SAML_WANT_AUTHN_RESPONSE_SIGNED),
      passReqToCallback: true,
    }
    try {
      passport.use(
        new SAMLStrategy(
          samlOptions,
          SAMLAuthenticationController.doPassportLogin,
          SAMLAuthenticationController.doPassportLogout
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
    const samlPolicyValidator = async ({ user, subscription }) => {
// If user is not logged in, user.externalAuth is undefined,
// in this case allow to change password if the user has a hashedPassword
      return user.externalAuth === 'saml' || (user.externalAuth === undefined && !user.hashedPassword)
    }
    try {
    PermissionsManager.registerPolicy(
      'samlPolicy',
      { 'change-password' : false },
      { validator: samlPolicyValidator }
    )
    } catch (error) {
      logger.info({}, error.message)
    }
  },
  async getGroupPolicyForUser(user, callback) {
    try {
      const userValidationMap = await PermissionsManager.promises.getUserValidationStatus({
        user,
        groupPolicy : { 'samlPolicy' : true },
        subscription : null
      })
      let groupPolicy = Object.fromEntries(userValidationMap)
      callback(null,  {'groupPolicy' : groupPolicy })
    } catch (error) {
      callback(error)
    }
  },
}

export default SAMLModuleManager
