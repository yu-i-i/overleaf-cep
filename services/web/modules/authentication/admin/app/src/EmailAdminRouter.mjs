import logger from '@overleaf/logger'
import EmailAdminController from './EmailAdminController.mjs'
import AuthorizationMiddleware from '../../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init Email Admin router')

    webRouter.get(
      '/admin/email',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      EmailAdminController.adminPage
    )

    webRouter.get(
      '/admin/email/config',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      EmailAdminController.getConfig
    )

    webRouter.post(
      '/admin/email/config',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      EmailAdminController.saveConfig
    )

    webRouter.post(
      '/admin/email/test',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      EmailAdminController.testEmail
    )
  },
}
