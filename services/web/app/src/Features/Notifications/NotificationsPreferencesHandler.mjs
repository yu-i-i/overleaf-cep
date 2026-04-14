import { db, ObjectId } from '../../infrastructure/mongodb.mjs'
import { callbackifyAll } from '@overleaf/promise-utils'
import ProjectGetter from '../Project/ProjectGetter.mjs'
import Errors from '../Errors/Errors.js'

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

function _hasProjectAccess(project, userId) {
  if (!project) return false
  const userIdString = new ObjectId(userId).toString()

  if (project.owner_ref?.toString() === userIdString) {
    return true
  }

  const ids = [
    ...(project.collaberator_refs || []),
    ...(project.readOnly_refs || []),
    ...(project.tokenAccessReadAndWrite_refs || []),
    ...(project.tokenAccessReadOnly_refs || []),
  ]

  return ids.some(id => id?.toString() === userIdString)
}

async function _ensureProjectMembership(userId, projectId) {
  const project = await ProjectGetter.promises.getProject(projectId, {
    owner_ref: 1,
    collaberator_refs: 1,
    readOnly_refs: 1,
    tokenAccessReadAndWrite_refs: 1,
    tokenAccessReadOnly_refs: 1,
  })

  if (!project) {
    throw new Errors.NotFoundError(`project ${projectId} not found`)
  }

  if (!_hasProjectAccess(project, userId)) {
    throw new Errors.ForbiddenError(
      `user ${userId} is not allowed to access project ${projectId}`
    )
  }
}

function _preferenceQuery(userId, projectId) {
  return {
    user_id: new ObjectId(userId),
    project_id: new ObjectId(projectId),
  }
}

async function getProjectPreferences(userId, projectId) {
  await _ensureProjectMembership(userId, projectId)

  const preference = await db.notificationsPreferences.findOne(
    _preferenceQuery(userId, projectId)
  )

  return preference ? _normalizePreferences(preference) : DEFAULT_NOTIFICATION_PREFERENCES
}

async function saveProjectPreferences(userId, projectId, preferences) {
  await _ensureProjectMembership(userId, projectId)
  const normalizedPreferences = _normalizePreferences(preferences)

  await db.notificationsPreferences.updateOne(
    _preferenceQuery(userId, projectId),
    { $set: normalizedPreferences },
    { upsert: true }
  )

  return normalizedPreferences
}

const NotificationsPreferencesHandler = {
  getProjectPreferences,
  saveProjectPreferences,
}

NotificationsPreferencesHandler.promises = {
  getProjectPreferences,
  saveProjectPreferences,
}

export default NotificationsPreferencesHandler
