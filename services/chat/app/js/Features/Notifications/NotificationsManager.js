// @ts-check

import logger from '@overleaf/logger'
import { db, ObjectId } from '../../mongodb.js'
import * as ThreadManager from '../Threads/ThreadManager.js'

const DEFAULT_NOTIFICATION_PREFERENCES = {
  commentOnOwnProject: true,
  commentOnInvitedProject: true,
  repliesOnAuthoredThread: true,
  repliesOnParticipatingThread: true,
  commentResolvedOnAuthoredThread: true,
  commentResolvedOnParticipatingThread: true,
  commentReopenedOnAuthoredThread: true,
  commentReopenedOnParticipatingThread: true,
  trackedChangesOnOwnProject: true,
  trackedChangesOnInvitedProject: true,
  trackChangesAcceptedOnAuthoredChange: true,
  trackChangesRejectedOnAuthoredChange: true,
}

function _normalizePreferences(preferences) {
  const normalized = {}
  for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)) {
    normalized[key] =
      preferences?.[key] === undefined ? true : Boolean(preferences?.[key])
  }
  return normalized
}

async function _loadProject(projectId) {
  return await db.projects.findOne(
    { _id: new ObjectId(projectId) },
    {
      projection: {
        owner_ref: 1,
        collaberator_refs: 1,
        readOnly_refs: 1,
        tokenAccessReadAndWrite_refs: 1,
        tokenAccessReadOnly_refs: 1,
        name: 1,
      },
    }
  )
}

async function _loadSenderName(senderId) {
  const user = await db.users.findOne(
    { _id: new ObjectId(senderId) },
    { projection: { first_name: 1, last_name: 1, email: 1 } }
  )
  if (!user) return 'Someone'
  return (
    [user.first_name, user.last_name].filter(Boolean).join(' ') ||
    user.email ||
    'Someone'
  )
}

async function _loadProjectPreferences(projectId, userIds) {
  const map = new Map()
  const docs = await db.notificationsPreferences
    .find({
      user_id: { $in: userIds.map(id => new ObjectId(id)) },
      project_id: new ObjectId(projectId),
    })
    .toArray()
  for (const doc of docs) {
    map.set(doc.user_id.toString(), _normalizePreferences(doc))
  }
  return map
}

async function _loadMutedUserIds(userIds) {
  const map = new Map()
  const docs = await db.notificationsPreferences
    .find({
      user_id: { $in: userIds.map(id => new ObjectId(id)) },
      project_id: null,
      muteAllNotifications: true,
    })
    .toArray()
  for (const doc of docs) {
    map.set(doc.user_id.toString(), true)
  }
  return map
}

function _shouldNotifyComment(preferences, isOwner) {
  return isOwner
    ? preferences.commentOnOwnProject
    : preferences.commentOnInvitedProject
}

function _shouldNotifyReply(preferences, isOwner, isThreadAuthor, isThreadParticipant) {
  return (
    (isThreadAuthor && preferences.repliesOnAuthoredThread) ||
    (!isThreadAuthor && isThreadParticipant && preferences.repliesOnParticipatingThread)
  )
}

async function _loadThreadAuthorId(threadId) {
  const firstMessage = await db.messages
    .find({ room_id: new ObjectId(threadId) })
    .sort({ timestamp: 1 })
    .limit(1)
    .toArray()
  return firstMessage[0]?.user_id?.toString()
}

/**
 * Schedule in-app + email notifications for a new chat message.
 *
 * Called from MessageHttpController (fire-and-forget) after the message is
 * persisted.
 *
 * In-app: `notifications` upsert (keyed, dedup-safe).
 * Email:  `emailNotifications` upsert keyed on (recipient_id, project_id,
 * emailType) so it is idempotent across re-runs and shares the dispatch
 * queue with project-change emails (handled by the web module cron).
 */
export async function createThreadMessageNotifications(
  projectId,
  thread,
  messageId,
  senderId
) {
  if (thread.thread_id === ThreadManager.GLOBAL_THREAD) {
    return
  }

  const senderIdString = new ObjectId(senderId).toString()

  const project = await _loadProject(projectId)
  if (!project) {
    logger.warn({ projectId }, 'project not found for notification creation')
    return
  }

  const projectUserIds = new Set(
    [
      project.owner_ref,
      ...(project.collaberator_refs || []),
      ...(project.readOnly_refs || []),
      ...(project.tokenAccessReadAndWrite_refs || []),
      ...(project.tokenAccessReadOnly_refs || []),
    ].filter(Boolean)
  )
    .map(id => id.toString())
    .filter(id => id !== senderIdString)

  if (projectUserIds.size === 0) {
    return
  }

  const preferencesById = await _loadProjectPreferences(
    projectId,
    [...projectUserIds]
  )
  const mutedById = await _loadMutedUserIds([...projectUserIds])
  const senderName = await _loadSenderName(senderId)

  const totalMessages = await db.messages.countDocuments({
    room_id: new ObjectId(thread._id),
  })
  const isComment = totalMessages === 1
  const templateKey = isComment
    ? 'notification_comment_on_project'
    : 'notification_reply_on_project'
  const threadAuthorId = isComment ? null : await _loadThreadAuthorId(thread._id)

  const participants = new Set(
    (
      await db.messages
        .distinct('user_id', { room_id: new ObjectId(thread._id) })
    ).map(id => id?.toString())
      .filter(Boolean)
  )

  const ownerId = project.owner_ref?.toString()
  const recipients = new Set()

  for (const recipientId of projectUserIds) {
    if (mutedById.has(recipientId)) {
      continue
    }

    const preferences =
      preferencesById.get(recipientId) || DEFAULT_NOTIFICATION_PREFERENCES
    const isOwner = recipientId === ownerId

    const notify = isComment
      ? _shouldNotifyComment(preferences, isOwner)
      : _shouldNotifyReply(
          preferences,
          isOwner,
          recipientId === threadAuthorId,
          participants.has(recipientId)
        )

    if (notify) {
      recipients.add(recipientId)
    }
  }

  if (recipients.size === 0) {
    return
  }

  const projectName = project.name || 'project'
  const notificationKeyPrefix = isComment ? 'project-comment' : 'project-reply'
  const threadIdString = thread.thread_id?.toString() || ''
  const messageOpts = {
    projectId: projectId.toString(),
    projectName,
    userName: senderName,
    threadId: threadIdString,
  }

  await Promise.all(
    [...recipients].map(recipientId => {
      const key = `${notificationKeyPrefix}-${projectId}-${threadIdString}-${messageId.toString()}`
      return db.notifications.updateOne(
        { user_id: new ObjectId(recipientId), key },
        {
          $set: {
            user_id: new ObjectId(recipientId),
            key,
            messageOpts,
            templateKey,
          },
        },
        { upsert: true }
      )
    })
  )

  const emailDocs = [...recipients].map(recipientId => ({
    recipient_id: new ObjectId(recipientId),
    emailType: 'projectNotification',
    opts: {
      projectId: projectId.toString(),
      projectName,
      userName: senderName,
      threadId: threadIdString,
      isComment,
    },
  }))

  // Idempotent: refresh existing scheduled doc for this (recipient, project).
  await Promise.all(
    emailDocs.map(({ recipient_id, emailType, opts }) =>
      db.emailNotifications.updateOne(
        {
          recipient_id,
          project_id: new ObjectId(projectId),
          emailType,
        },
        {
          $set: {
            recipient_id,
            project_id: new ObjectId(projectId),
            emailType,
            opts,
            scheduledAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      )
    )
  )
}
