import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { readFilesContentFromEnv, numFromEnv, boolFromEnv } from '../../../utils.mjs'
import { getSAMLProviderConfig } from '../../../ssoConfigLoader.mjs'
import PermissionsManager from '../../../../../app/src/Features/Authorization/PermissionsManager.mjs'
import SAMLAuthenticationController from './SAMLAuthenticationController.mjs'
import { Strategy as SAMLStrategy } from '@node-saml/passport-saml'

const SAMLModuleManager = {
  async initSettings() {
    const dbProvider = await getSAMLProviderConfig()
    if (dbProvider) {
      Settings.saml = {
        enable: true,
        identityServiceName: dbProvider.identityServiceName || dbProvider.buttonLabel || 'Log in with SAML IdP',
        attUserId:    dbProvider.userIdField || 'nameID',
        attEmail:     dbProvider.emailField || 'nameID',
        attFirstName: dbProvider.firstNameField || 'givenName',
        attLastName:  dbProvider.lastNameField || 'lastName',
        attAdmin:     dbProvider.isAdminField || undefined,
        valAdmin:     dbProvider.isAdminFieldValue || undefined,
        updateUserDetailsOnLogin: !!dbProvider.updateUserDetailsOnLogin,
      }
      Settings._samlDbProvider = dbProvider
    } else {
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
    }
  },
  passportSetup(passport, callback) {
    const dbProvider = Settings._samlDbProvider
    // Skip gracefully if required SAML fields are missing — prevents blocking
    // other modules (e.g. OIDC) from registering their passport strategies.
    if (dbProvider) {
      if (!dbProvider.issuer || !dbProvider.entryPoint) {
        logger.warn({}, 'SAML provider is missing required fields (issuer/entryPoint) — skipping passport strategy registration')
        return callback(null)
      }
    } else {
      if (!process.env.OVERLEAF_SAML_ISSUER || !process.env.OVERLEAF_SAML_ENTRYPOINT) {
        logger.warn({}, 'SAML env vars OVERLEAF_SAML_ISSUER/ENTRYPOINT not set — skipping passport strategy registration')
        return callback(null)
      }
    }
    let samlOptions
    if (dbProvider) {
      let authnContext
      if (dbProvider.authnContext) {
        try { authnContext = JSON.parse(dbProvider.authnContext) } catch(e) { /* ignore */ }
      }
      samlOptions = {
        entryPoint: dbProvider.entryPoint,
        callbackUrl: `${Settings.siteUrl.replace(/\/+$/, '')}/saml/login/callback`,
        issuer: dbProvider.issuer,
        audience: dbProvider.audience || undefined,
        idpCert: dbProvider.idpCert ? readFilesContentFromEnv(dbProvider.idpCert) : undefined,
        privateKey: dbProvider.privateKey ? readFilesContentFromEnv(dbProvider.privateKey) : undefined,
        decryptionPvk: dbProvider.decryptionPvk ? readFilesContentFromEnv(dbProvider.decryptionPvk) : undefined,
        signatureAlgorithm: dbProvider.signatureAlgorithm || undefined,
        additionalParams: dbProvider.additionalParams ? JSON.parse(dbProvider.additionalParams) : {},
        additionalAuthorizeParams: dbProvider.additionalAuthorizeParams ? JSON.parse(dbProvider.additionalAuthorizeParams) : {},
        identifierFormat: dbProvider.identifierFormat || undefined,
        acceptedClockSkewMs: dbProvider.acceptedClockSkewMs ? Number(dbProvider.acceptedClockSkewMs) : undefined,
        attributeConsumingServiceIndex: dbProvider.attributeConsumingServiceIndex || undefined,
        authnContext: authnContext,
        forceAuthn: !!dbProvider.forceAuthn,
        disableRequestedAuthnContext: !!dbProvider.disableRequestedAuthnContext,
        skipRequestCompression: dbProvider.authnRequestBinding === 'HTTP-POST',
        authnRequestBinding: dbProvider.authnRequestBinding || undefined,
        validateInResponseTo: dbProvider.validateInResponseTo || undefined,
        requestIdExpirationPeriodMs: dbProvider.requestIdExpirationPeriodMs ? Number(dbProvider.requestIdExpirationPeriodMs) : undefined,
        logoutUrl: dbProvider.logoutURL || undefined,
        logoutCallbackUrl: `${Settings.siteUrl.replace(/\/+$/, '')}/saml/logout/callback`,
        additionalLogoutParams: dbProvider.additionalLogoutParams ? JSON.parse(dbProvider.additionalLogoutParams) : {},
        wantAssertionsSigned: !!dbProvider.wantAssertionsSigned,
        wantAuthnResponseSigned: !!dbProvider.wantAuthnResponseSigned,
        passReqToCallback: true,
      }
    } else {
      samlOptions = {
        entryPoint: process.env.OVERLEAF_SAML_ENTRYPOINT,
        callbackUrl: `${Settings.siteUrl.replace(/\/+$/, '')}/saml/login/callback`,
        issuer: process.env.OVERLEAF_SAML_ISSUER,
        audience: process.env.OVERLEAF_SAML_AUDIENCE,
        idpCert: readFilesContentFromEnv(process.env.OVERLEAF_SAML_IDP_CERT),
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
        skipRequestCompression: process.env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING === 'HTTP-POST',
        authnRequestBinding: process.env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING,
        validateInResponseTo: process.env.OVERLEAF_SAML_VALIDATE_IN_RESPONSE_TO,
        requestIdExpirationPeriodMs: numFromEnv(process.env.OVERLEAF_SAML_REQUEST_ID_EXPIRATION_PERIOD_MS),
        logoutUrl: process.env.OVERLEAF_SAML_LOGOUT_URL,
        logoutCallbackUrl: `${Settings.siteUrl.replace(/\/+$/, '')}/saml/logout/callback`,
        additionalLogoutParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_LOGOUT_PARAMS || '{}'),
        wantAssertionsSigned: boolFromEnv(process.env.OVERLEAF_SAML_WANT_ASSERTIONS_SIGNED),
        wantAuthnResponseSigned: boolFromEnv(process.env.OVERLEAF_SAML_WANT_AUTHN_RESPONSE_SIGNED),
        passReqToCallback: true,
      }
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
      PermissionsManager.registerCapability('use-ai', { default : false })
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
  getGroupPolicyForUser(user, callback) {
    PermissionsManager.promises.getUserValidationStatus({
      user,
      groupPolicy : { 'samlPolicy' : true },
      subscription : null
    }).then(userValidationMap => {
      let groupPolicy = Object.fromEntries(userValidationMap)
      callback(null, { groupPolicy })
    }).catch(error => {
      callback(error)
    })
  },
}

export default SAMLModuleManager
