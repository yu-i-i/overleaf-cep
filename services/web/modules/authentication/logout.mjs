import { isSAMLEnabled, isOIDCEnabled } from './ssoConfigLoader.mjs'

let SAMLAuthenticationController
const samlEnabled = process.env.EXTERNAL_AUTH?.includes('saml') || await isSAMLEnabled()
if (samlEnabled) {
  SAMLAuthenticationController = await import('./saml/app/src/SAMLAuthenticationController.mjs')
}
let OIDCAuthenticationController
const oidcEnabled = process.env.EXTERNAL_AUTH?.includes('oidc') || await isOIDCEnabled()
if (oidcEnabled) {
  OIDCAuthenticationController = await import('./oidc/app/src/OIDCAuthenticationController.mjs')
}
export default async function logout(req, res, next) {
  switch(req.user?.externalAuth) {
    case 'saml':
      if (SAMLAuthenticationController) {
        return SAMLAuthenticationController.default.passportLogout(req, res, next)
      }
      return next()
    case 'oidc':
      if (OIDCAuthenticationController) {
        return OIDCAuthenticationController.default.passportLogout(req, res, next)
      }
      return next()
    default:
      next()
  }
}
