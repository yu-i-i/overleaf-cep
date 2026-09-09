import logger from '@overleaf/logger'
import AdminPanelShellController from './AdminPanelShellController.mjs'
import MySettingsShellController from './MySettingsShellController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import PermissionsController from '../../../../app/src/Features/Authorization/PermissionsController.mjs'

/**
 * PSH — Page shells router (UI-R10 W8).
 *
 *   GET /admin/panel     Site-admin shell over the upstream /admin tabset.
 *   GET /user/mysettings Logged-in shell over the upstream /user/settings
 *                        account page (same locals, same React app).
 *
 * Both are thin SAME-ORIGIN wrappers: the upstream handlers are invoked
 * directly (their locals are captured by intercepting res.render) and then
 * rendered into this module's own views. The upstream pages themselves
 * keep working on their original URLs.
 */
const PageShellsRouter = {
  apply(webRouter) {
    logger.debug({}, 'Init PageShells router')

    webRouter.get(
      '/user/mysettings',
      AuthenticationController.requireLogin(),
      PermissionsController.useCapabilities(),
      MySettingsShellController.mySettingsPage
    )

    webRouter.get(
      '/admin/panel',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      AdminPanelShellController.adminPanelPage
    )
  },
}

export default PageShellsRouter
