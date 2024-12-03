import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.js'
import { passportSamlAuthWithIdP, passportSamlSPLogout, passportSamlMetadata} from './AuthenticationControllerSaml.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init SAML router')
    webRouter.get('/saml/login', passportSamlAuthWithIdP)
    AuthenticationController.addEndpointToLoginWhitelist('/saml/login')
    webRouter.post('/saml/logout', AuthenticationController.requireLogin(), passportSamlSPLogout)
    webRouter.get('/saml/meta', passportSamlMetadata)
    AuthenticationController.addEndpointToLoginWhitelist('/saml/meta')
  },
}
