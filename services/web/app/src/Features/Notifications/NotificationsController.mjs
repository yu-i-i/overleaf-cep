import NotificationsHandler from './NotificationsHandler.mjs'
import NotificationsPreferencesHandler from './NotificationsPreferencesHandler.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import { parseReq, z, zz } from '@overleaf/validation-tools'
import _ from 'lodash'

const projectIdParamsSchema = z.object({
  params: z.object({
    projectId: zz.objectId(),
  }),
})

const notificationPreferencesSchema = z.object({
  trackedChangesOnOwnProject: z.boolean(),
  trackedChangesOnInvitedProject: z.boolean(),
  commentOnOwnProject: z.boolean(),
  commentOnInvitedProject: z.boolean(),
  repliesOnOwnProject: z.boolean(),
  repliesOnInvitedProject: z.boolean(),
  repliesOnAuthoredThread: z.boolean(),
  repliesOnParticipatingThread: z.boolean(),
  sendCommentReplyEmails: z.boolean(),
})

const getProjectPreferencesSchema = projectIdParamsSchema
const saveProjectPreferencesSchema = z.object({
  params: z.object({
    projectId: zz.objectId(),
  }),
  body: notificationPreferencesSchema,
})

async function getProjectPreferences(req, res, next) {
  try {
    const { params } = parseReq(req, getProjectPreferencesSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)
    const preferences = await NotificationsPreferencesHandler.promises.getProjectPreferences(
      userId,
      params.projectId
    )
    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

async function saveProjectPreferences(req, res, next) {
  try {
    const { params, body } = parseReq(req, saveProjectPreferencesSchema)
    const userId = SessionManager.getLoggedInUserId(req.session)
    const preferences = await NotificationsPreferencesHandler.promises.saveProjectPreferences(
      userId,
      params.projectId,
      body
    )
    res.json(preferences)
  } catch (err) {
    next(err)
  }
}

export default {
  getAllUnreadNotifications(req, res, next) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    NotificationsHandler.getUserNotifications(
      userId,
      function (err, unreadNotifications) {
        if (err) {
          return next(err)
        }
        unreadNotifications = _.map(
          unreadNotifications,
          function (notification) {
            notification.html = notification.templateKey
              ? req.i18n.translate(
                  notification.templateKey,
                  notification.messageOpts
                )
              : notification.html
            return notification
          }
        )
        res.json(unreadNotifications)
      }
    )
  },

  markNotificationAsRead(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { notificationId } = req.params
    NotificationsHandler.markAsRead(userId, notificationId, () =>
      res.sendStatus(200)
    )
  },

  getNotification(req, res, next) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { notificationId } = req.params
    NotificationsHandler.getUserNotifications(
      userId,
      function (err, unreadNotifications) {
        if (err) {
          return next(err)
        }
        const notification = unreadNotifications.find(
          n => n._id === notificationId
        )

        if (!notification) {
          return res.status(404).end()
        }

        res.json(notification)
      }
    )
  },

  getProjectPreferences,
  saveProjectPreferences,
}
