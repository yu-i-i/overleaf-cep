import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ZoteroController from './ZoteroController.mjs'

export default {
  apply(webRouter) {
    // Get Zotero groups for the create-file modal
    webRouter.get(
      '/user/zotero/groups',
      AuthenticationController.requireLogin(),
      ZoteroController.getGroups
    )

    // Unlink Zotero account
    webRouter.delete(
      '/user/zotero',
      AuthenticationController.requireLogin(),
      ZoteroController.unlink
   )
    webRouter.get(
      '/user/zotero/status',
      AuthenticationController.requireLogin(),
      ZoteroController.getConnectionStatus
    )

    webRouter.get(
      '/user/zotero/oauth',
      AuthenticationController.requireLogin(),
      ZoteroController.oauth
    )
    // callback for Zotero OAuth flow
    webRouter.get(
      '/user/zotero/oauth/callback',
      AuthenticationController.requireLogin(),
      ZoteroController.oauthCallback
    )



  },
}
