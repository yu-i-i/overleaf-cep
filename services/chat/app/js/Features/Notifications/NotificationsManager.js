// @ts-check

import logger from '@overleaf/logger'
import * as ThreadManager from '../Threads/ThreadManager.js'
import { db, ObjectId } from '../../mongodb.js'

const DEFAULT_NOTIFICATION_PREFERENCES = {
  trackedChangesOnOwnProject: true,
  trackedChangesOnInvitedProject: true,
  commentOnOwnProject: true,
  commentOnInvitedProject: true,
  repliesOnOwnProject: true,
  repliesOnInvitedProject: true,
  repliesOnAuthoredThread: true,
  repliesOnParticipatingThread: true,
  sendCommentReplyEmails: true,
}

function _normalizePreferences(preferences) {
  return {
    trackedChangesOnOwnProject: Boolean(preferences.trackedChangesOnOwnProject),
    trackedChangesOnInvitedProject: Boolean(
      preferences.trackedChangesOnInvitedProject
    ),
    commentOnOwnProject: Boolean(preferences.commentOnOwnProject),
    commentOnInvitedProject: Boolean(preferences.commentOnInvitedProject),
    repliesOnOwnProject: Boolean(preferences.repliesOnOwnProject),
    repliesOnInvitedProject: Boolean(preferences.repliesOnInvitedProject),
    repliesOnAuthoredThread: Boolean(preferences.repliesOnAuthoredThread),
    repliesOnParticipatingThread: Boolean(
      preferences.repliesOnParticipatingThread
    ),
    sendCommentReplyEmails: Boolean(preferences.sendCommentReplyEmails),
  }
}

function _formatUserName(user) {
  if (!user) {
    return 'Someone'
  }
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name || user.email || user._id?.toString() || 'Someone'
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
  if (!ObjectId.isValid(senderId)) {
    return senderId?.toString() || 'Someone'
  }
  const user = await db.users.findOne(
    { _id: new ObjectId(senderId) },
    { projection: { first_name: 1, last_name: 1, email: 1 } }
  )
  return _formatUserName(user)
}

async function _loadValidProjectUserIds(project) {
  const memberIds = new Set()
  if (project.owner_ref) {
    memberIds.add(project.owner_ref.toString())
  }
  for (const field of [
    project.collaberator_refs,
    project.readOnly_refs,
    project.tokenAccessReadAndWrite_refs,
    project.tokenAccessReadOnly_refs,
  ]) {
    if (!Array.isArray(field)) {
      continue
    }
    for (const id of field) {
      if (id) {
        memberIds.add(id.toString())
      }
    }
  }

  const validObjectIds = [...memberIds]
    .filter(id => ObjectId.isValid(id))
    .map(id => new ObjectId(id))
  if (!validObjectIds.length) {
    return []
  }

  const users = await db.users
    .find({ _id: { $in: validObjectIds } }, { projection: { _id: 1 } })
    .toArray()

  return users.map(user => user._id.toString())
}

async function _loadPreferencesByUser(projectId, userIds) {
  if (!userIds.length) {
    return new Map()
  }

  const selection = {
    project_id: new ObjectId(projectId),
    user_id: { $in: userIds.map(id => new ObjectId(id)) },
  }

  const preferencesByUser = new Map()
  const collections = [db.notificationsPreferences]
  if (db.notificationsPreferencesLegacy) {
    collections.push(db.notificationsPreferencesLegacy)
  }

  for (const collection of collections) {
    const preferencesDocs = await collection.find(selection).toArray()
    for (const preferencesDoc of preferencesDocs) {
      const userId = preferencesDoc.user_id.toString()
      if (!preferencesByUser.has(userId)) {
        preferencesByUser.set(userId, _normalizePreferences(preferencesDoc))
      }
    }
  }

  return preferencesByUser
}

async function _loadUserEmailPreferences(userIds) {
  if (!userIds.length) {
    return new Map()
  }

  const users = await db.users
    .find(
      { _id: { $in: userIds.map(id => new ObjectId(id)) } },
      { projection: { notificationEmailPreferences: 1 } }
    )
    .toArray()

  const preferencesByUser = new Map()
  for (const user of users) {
    preferencesByUser.set(user._id.toString(), {
      enabled:
        user.notificationEmailPreferences?.enabled !== false,
      projectCommentReply:
        user.notificationEmailPreferences?.projectCommentReply !== false,
      projectInvite:
        user.notificationEmailPreferences?.projectInvite !== false,
    })
  }

  return preferencesByUser
}

function _shouldNotifyComment(preferences, isOwner) {
  return isOwner
    ? preferences.commentOnOwnProject
    : preferences.commentOnInvitedProject
}

function _shouldNotifyReply(
  preferences,
  isOwner,
  isThreadAuthor,
  isThreadParticipant
) {
  return (
    (isThreadAuthor && preferences.repliesOnAuthoredThread) ||
    (!isThreadAuthor && isThreadParticipant &&
      preferences.repliesOnParticipatingThread) ||
    (isOwner && preferences.repliesOnOwnProject) ||
    (!isOwner && preferences.repliesOnInvitedProject)
  )
}

function _shouldSendCommentReplyEmail(preferences) {
  return Boolean(preferences.sendCommentReplyEmails)
}

function _shouldReceiveProjectCommentReplyEmail(userPreferences) {
  if (!userPreferences) {
    return true
  }
  if (!userPreferences.enabled) {
    return false
  }
  return Boolean(userPreferences.projectCommentReply)
}

async function _loadThreadAuthorId(threadId) {
  const firstMessage = await db.messages.findOne(
    { room_id: threadId },
    {
      projection: { user_id: 1 },
      sort: { timestamp: 1 },
    }
  )
  return firstMessage?.user_id?.toString()
}

export async function createThreadMessageNotifications(
  projectId,
  thread,
  messageId,
  senderId
) {
  if (thread.thread_id === ThreadManager.GLOBAL_THREAD) {
    return
  }
  if (!ObjectId.isValid(projectId) || !ObjectId.isValid(senderId)) {
    return
  }

  const project = await _loadProject(projectId)
  if (!project) {
    logger.warn({ projectId }, 'project not found for notification creation')
    return
  }

  const projectUserIds = await _loadValidProjectUserIds(project)
  if (!projectUserIds.length) {
    return
  }

  const preferencesByUser = await _loadPreferencesByUser(
    projectId,
    projectUserIds
  )
  const userEmailPreferencesByUser = await _loadUserEmailPreferences(
    projectUserIds
  )
  const senderName = await _loadSenderName(senderId)
  const totalMessages = await db.messages.countDocuments({
    room_id: thread._id,
  })
  const isComment = totalMessages === 1
  const templateKey = isComment
    ? 'notification_comment_on_project'
    : 'notification_reply_on_project'
  const threadAuthorId = isComment
    ? null
    : await _loadThreadAuthorId(thread._id)

  const participantIds = await db.messages.distinct('user_id', {
    room_id: thread._id,
  })
  const participantIdSet = new Set(
    participantIds.map(id => id?.toString()).filter(Boolean)
  )

  const ownerId = project.owner_ref?.toString()
  const recipients = new Set()
  const emailRecipients = new Set()

  for (const recipientId of projectUserIds) {
    if (recipientId === senderId.toString()) {
      continue
    }

    const preferences =
      preferencesByUser.get(recipientId) || DEFAULT_NOTIFICATION_PREFERENCES
    const userEmailPreferences = userEmailPreferencesByUser.get(recipientId)
    const isOwner = recipientId === ownerId
    const shouldEmail =
      _shouldSendCommentReplyEmail(preferences) &&
      _shouldReceiveProjectCommentReplyEmail(userEmailPreferences)
    if (isComment) {
      if (_shouldNotifyComment(preferences, isOwner)) {
        recipients.add(recipientId)
        if (shouldEmail) {
          emailRecipients.add(recipientId)
        }
      }
      continue
    }

    const isThreadAuthor = recipientId === threadAuthorId
    const isThreadParticipant = participantIdSet.has(recipientId)
    if (
      _shouldNotifyReply(
        preferences,
        isOwner,
        isThreadAuthor,
        isThreadParticipant
      )
    ) {
      recipients.add(recipientId)
      if (shouldEmail) {
        emailRecipients.add(recipientId)
      }
    }
  }

  if (!recipients.size && !emailRecipients.size) {
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

  if (emailRecipients.size) {
    const emailNotifications = [...emailRecipients].map(recipientId => ({
      recipient_id: new ObjectId(recipientId),
      emailType: 'projectNotification',
      opts: {
        projectId: projectId.toString(),
        projectName,
        userName: senderName,
        threadId: threadIdString,
        isComment,
      },
      scheduledAt: new Date(),
      createdAt: new Date(),
    }))

    await db.emailNotifications.insertMany(emailNotifications)
  }
}

const NotificationsManager = {
  createThreadMessageNotifications,
}

export default NotificationsManager
