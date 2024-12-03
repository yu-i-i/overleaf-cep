import logger from '@overleaf/logger'
import { passportSamlLogin, passportSamlIdPLogout } from './AuthenticationControllerSaml.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init SAML NonCsrfRouter')
    webRouter.get('/saml/login/callback', passportSamlLogin)
    webRouter.post('/saml/login/callback', passportSamlLogin)
    webRouter.get('/saml/logout/callback', passportSamlIdPLogout)
    webRouter.post('/saml/logout/callback', passportSamlIdPLogout)
  },
}
