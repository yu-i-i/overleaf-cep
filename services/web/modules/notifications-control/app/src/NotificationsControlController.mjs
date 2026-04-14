// @ts-check

import { parseReq, z } from '../../../../app/src/infrastructure/Validation.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import { User } from '../../../../app/src/models/User.mjs'

const notificationEmailPreferencesSchema = z.object({
  enabled: z.boolean(),
  projectCommentReplyEmails: z.boolean(),
  projectInviteEmails: z.boolean(),
})

const updateNotificationEmailPreferencesSchema = z.object({
  body: notificationEmailPreferencesSchema,
})

async function emailPreferencesPage(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await UserGetter.promises.getUser(userId, {
      _id: 1,
      email: 1,
      first_name: 1,
      last_name: 1,
      notificationEmailPreferences: 1,
    })

    if (!user) {
      throw new Error('User not found')
    }

    const notificationPreferences = user.notificationEmailPreferences || {
      enabled: true,
      projectCommentReply: true,
      projectInvite: true,
    }

    res.render('user/email-preferences', {
      title: 'notification_email_preferences_title',
      user,
      notificationPreferences,
    })
  } catch (err) {
    next(err)
  }
}

async function updateNotificationEmailPreferences(req, res, next) {
  try {
    const { body } = parseReq(req, updateNotificationEmailPreferencesSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          notificationEmailPreferences: {
            enabled: body.enabled,
            projectCommentReply: body.projectCommentReplyEmails,
            projectInvite: body.projectInviteEmails,
          },
        },
      }
    ).exec()

    res.json(body)
  } catch (err) {
    next(err)
  }
}

async function sendTestEmail(req, res, next) {
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await UserGetter.promises.getUser(userId, { email: 1 })

    if (!user || !user.email) {
      throw new Error('User email not found')
    }

    await EmailHandler.promises.sendEmail('testEmail', { to: user.email })

    res.json({ message: res.locals.translate('email_sent') })
  } catch (err) {
    next(err)
  }
}

export default {
  emailPreferencesPage,
  updateNotificationEmailPreferences,
  sendTestEmail,
}
