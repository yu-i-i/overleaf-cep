// @ts-check

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import NotificationsControlController from './NotificationsControlController.mjs'

function apply(webRouter, privateApiRouter, publicApiRouter) {
  webRouter.post(
    '/user/notification-email-preferences',
    AuthenticationController.requireLogin(),
    NotificationsControlController.updateNotificationEmailPreferences
  )

  webRouter.post(
    '/user/send-test-email',
    AuthenticationController.requireLogin(),
    NotificationsControlController.sendTestEmail
  )

  webRouter.get(
    '/user/email-preferences',
    AuthenticationController.requireLogin(),
    NotificationsControlController.emailPreferencesPage
  )
}

export default {
  apply,
}
