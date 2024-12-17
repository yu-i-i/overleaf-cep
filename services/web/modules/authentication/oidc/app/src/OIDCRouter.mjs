import logger from '@overleaf/logger'
import UserController from '../../../../../app/src/Features/User/UserController.js'
import OIDCAuthenticationController from './OIDCAuthenticationController.mjs'
import logout from '../../../logout.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init OIDC router')
    webRouter.get('/oidc/login', OIDCAuthenticationController.passportLogin)
    webRouter.get('/oidc/login/callback', OIDCAuthenticationController.passportLoginCallback)
    webRouter.get('/oidc/logout/callback', OIDCAuthenticationController.passportLogoutCallback)
    webRouter.post('/user/oauth-unlink', OIDCAuthenticationController.unlinkAccount)
    webRouter.post('/logout', logout, UserController.logout)
  },
}
