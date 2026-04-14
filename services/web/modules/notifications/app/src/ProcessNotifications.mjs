import logger from '@overleaf/logger'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { db, connectionPromise } from '../../../../app/src/infrastructure/mongodb.mjs'

const BATCH_SIZE = Number(process.env.PROCESS_NOTIFICATIONS_BATCH_SIZE) || 100
const STALE_PROCESSING_MS = 1000 * 60 * 60 // 1 hour

function _buildEmailTask(notification) {
  const emailType = notification.emailType || notification.type
  const opts = notification.opts || notification.options || notification.data || {}

  if (!emailType) {
    throw new Error('scheduled email notification is missing emailType')
  }

  // keep toUserId only as fallback; actual resolution happens in processNotifications
  if (notification.recipient_id && !opts.to && !opts.toUserId) {
    opts.toUserId = notification.recipient_id
  }

  if (notification.project_id && opts.projectId == null) {
    opts.projectId = notification.project_id
  }

  return { emailType, opts }
}

function _claimNextDueNotification() {
  const now = new Date()
  const staleTime = new Date(Date.now() - STALE_PROCESSING_MS)

  return db.emailNotifications.findOneAndUpdate(
    {
      scheduledAt: { $lte: now },
      $or: [
        { processing: { $exists: false } },
        { processing: false },
        { processingStartedAt: { $lt: staleTime } },
      ],
    },
    {
      $set: { processing: true, processingStartedAt: new Date() },
    },
    {
      sort: { scheduledAt: 1 },
      returnDocument: 'after',
    }
  )
}

export async function processNotifications() {
  await connectionPromise

  let processedCount = 0

  while (processedCount < BATCH_SIZE) {
    const notification = await _claimNextDueNotification()
    if (!notification) {
      break
    }

    try {
      const { emailType, opts } = _buildEmailTask(notification)

      // Resolve recipient_id to actual email address if not already set
      if (!opts.to && opts.toUserId) {
        const user = await UserGetter.promises.getUser(opts.toUserId, {
          email: 1,
        })
        if (!user || !user.email) {
          throw new Error(
            `recipient user ${opts.toUserId} not found or has no email`
          )
        }
        opts.to = user.email
        delete opts.toUserId
      }

      await EmailHandler.promises.sendEmail(emailType, opts)
      await db.emailNotifications.deleteOne({ _id: notification._id })
      processedCount += 1
    } catch (err) {
      logger.warn(
        { err, notificationId: notification._id },
        'failed to process scheduled email notification'
      )
      await db.emailNotifications.updateOne(
        { _id: notification._id },
        {
          $set: {
            processing: false,
            processingFailedAt: new Date(),
            processingError: err?.message || String(err),
          },
        }
      )
    }
  }

  logger.info({ processedCount }, 'scheduled email notifications processing finished')
  return processedCount
}
