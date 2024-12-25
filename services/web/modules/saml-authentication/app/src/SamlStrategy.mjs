import fs from 'fs'
import passport from 'passport'
import Settings from '@overleaf/settings'
import { doPassportSamlLogin, doPassportSamlLogout } from './AuthenticationControllerSaml.mjs'
import { Strategy as SamlStrategy } from '@node-saml/passport-saml'

function _readFilesContentFromEnv(envVar) {
// envVar is either a file name: 'file.pem', or string with array: '["file.pem", "file2.pem"]'
  if (!envVar) return undefined
  try {
    const parsedFileNames = JSON.parse(envVar)
    return parsedFileNames.map(filename => fs.readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) { // failed to parse, envVar must be a file name
      return fs.readFileSync(envVar, 'utf8')
    } else {
      throw error
    }
  }
}

const samlOptions = {
  entryPoint: process.env.OVERLEAF_SAML_ENTRYPOINT,
  callbackUrl: process.env.OVERLEAF_SAML_CALLBACK_URL,
  issuer: process.env.OVERLEAF_SAML_ISSUER,
  audience: process.env.OVERLEAF_SAML_AUDIENCE,
  cert: _readFilesContentFromEnv(process.env.OVERLEAF_SAML_IDP_CERT),
  signingCert: _readFilesContentFromEnv(process.env.OVERLEAF_SAML_PUBLIC_CERT),
  privateKey:  _readFilesContentFromEnv(process.env.OVERLEAF_SAML_PRIVATE_KEY),
  decryptionCert: _readFilesContentFromEnv(process.env.OVERLEAF_SAML_DECRYPTION_CERT),
  decryptionPvk:  _readFilesContentFromEnv(process.env.OVERLEAF_SAML_DECRYPTION_PVK),
  signatureAlgorithm: process.env.OVERLEAF_SAML_SIGNATURE_ALGORITHM,
  additionalParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_PARAMS || '{}'),
  additionalAuthorizeParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_AUTHORIZE_PARAMS || '{}'),
  identifierFormat: process.env.OVERLEAF_SAML_IDENTIFIER_FORMAT,
  acceptedClockSkewMs: process.env.OVERLEAF_SAML_ACCEPTED_CLOCK_SKEW_MS ? Number(process.env.OVERLEAF_SAML_ACCEPTED_CLOCK_SKEW_MS) : undefined,
  attributeConsumingServiceIndex: process.env.OVERLEAF_SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX,
  authnContext: process.env.OVERLEAF_SAML_AUTHN_CONTEXT ? JSON.parse(process.env.OVERLEAF_SAML_AUTHN_CONTEXT) : undefined,
  forceAuthn: String(process.env.OVERLEAF_SAML_FORCE_AUTHN).toLowerCase() === 'true',
  disableRequestedAuthnContext: String(process.env.OVERLEAF_SAML_DISABLE_REQUESTED_AUTHN_CONTEXT).toLowerCase() === 'true',
  skipRequestCompression: process.env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING === 'HTTP-POST',  // compression should be skipped iff authnRequestBinding is POST
  authnRequestBinding: process.env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING,
  validateInResponseTo: process.env.OVERLEAF_SAML_VALIDATE_IN_RESPONSE_TO,
  requestIdExpirationPeriodMs: process.env.OVERLEAF_SAML_REQUEST_ID_EXPIRATION_PERIOD_MS ? Number(process.env.OVERLEAF_SAML_REQUEST_ID_EXPIRATION_PERIOD_MS) : undefined,
//  cacheProvider: process.env.OVERLEAF_SAML_CACHE_PROVIDER,
  logoutUrl: process.env.OVERLEAF_SAML_LOGOUT_URL,
  logoutCallbackUrl: process.env.OVERLEAF_SAML_LOGOUT_CALLBACK_URL,
  additionalLogoutParams: JSON.parse(process.env.OVERLEAF_SAML_ADDITIONAL_LOGOUT_PARAMS || '{}'),
  passReqToCallback: true,
  wantAssertionsSigned: String(process.env.OVERLEAF_SAML_WANT_ASSERTIONS_SIGNED).toLowerCase() === 'true',
  wantAuthnResponseSigned: String(process.env.OVERLEAF_SAML_WANT_AUTHN_RESPONSE_SIGNED).toLowerCase() === 'true',
}

function addSamlStrategy(passport) {
  passport.use(
    new SamlStrategy(
      samlOptions,
      doPassportSamlLogin,
      doPassportSamlLogout
    )
  )
}

export default addSamlStrategy
