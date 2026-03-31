import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import ZoteroController from './ZoteroController.mjs'

export default {
  apply(webRouter) {
    // Get Zotero groups for the create-file modal
    webRouter.get(
      '/zotero/groups',
      AuthenticationController.requireLogin(),
      ZoteroController.getGroups
    )

    // Link Zotero account (user submits their API key)
    webRouter.post(
      '/zotero/link',
      AuthenticationController.requireLogin(),
      ZoteroController.link
    )

    // Unlink Zotero account
    webRouter.post(
      '/zotero/unlink',
      AuthenticationController.requireLogin(),
      ZoteroController.unlink
    )
  },
}
