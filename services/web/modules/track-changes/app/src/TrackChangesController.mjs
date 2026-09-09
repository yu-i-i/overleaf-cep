import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import { OError, NotFoundError, ForbiddenError } from '../../../../app/src/Features/Errors/Errors.js'
import pLimit from 'p-limit'

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const USER_ID_RE = /^[0-9a-fA-F]{24}$/

// Validate the track-changes state body: only the known keys, with the
// known types, so user input can never write operator-style garbage into
// project.track_changes (it is persisted verbatim by updateOne).
//
// Stored shape (what the review panel reads back):
//   true | false | { [userId|'__guests__']: boolean }
function validateTrackChangesState(body) {
  const { on, on_for, on_for_guests } = body
  if (on !== undefined && typeof on !== 'boolean') {
    throw new OError('"on" must be a boolean', { status: 400 })
  }
  if (on_for !== undefined) {
    if (!isPlainObject(on_for)) {
      throw new OError('"on_for" must be an object', { status: 400 })
    }
    for (const [userId, enabled] of Object.entries(on_for)) {
      if (userId !== '__guests__' && !USER_ID_RE.test(userId)) {
        throw new OError('"on_for" keys must be user ids', { status: 400 })
      }
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        throw new OError('"on_for" values must be booleans', { status: 400 })
      }
    }
  }
  if (on_for_guests !== undefined && typeof on_for_guests !== 'boolean') {
    throw new OError('"on_for_guests" must be a boolean', { status: 400 })
  }
  if (on === undefined && on_for === undefined && on_for_guests === undefined) {
    throw new OError('No track-changes fields provided', { status: 400 })
  }

  const state = {}
  if (isPlainObject(on_for)) {
    for (const [k, v] of Object.entries(on_for)) state[k] = v
  }
  if (on_for_guests !== undefined) state.__guests__ = on_for_guests
  if (on === true) return true
  if (on === false && Object.keys(state).length === 0) return false
  return state
}

const TrackChangesController = {
  async trackChanges(req, res, next) {
    let state
    try {
      state = validateTrackChangesState(req.body || {})
    } catch (err) {
      // Answer 400 directly: CE's generic error pipeline does not map
      // OError info.status to a 4xx response.
      res.status(400)
      res.json({ message: err.message || 'Invalid track-changes payload' })
      return
    }
    try {
      const { project_id } = req.params
      await Project.updateOne({_id: project_id}, {track_changes: state}).exec()
      EditorRealTimeController.emitToRoom(project_id, 'toggle-track-changes', state)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async acceptChanges(req, res, next) {
    try {
      const { project_id, doc_id } = req.params
      const change_ids = req.body.change_ids
      // Apply the change FIRST; only announce it to the room once it has
      // been applied, so a failure never desynchronises collaborators.
      await DocumentUpdaterHandler.promises.acceptChanges(project_id, doc_id, change_ids)
      EditorRealTimeController.emitToRoom(project_id, 'accept-changes', doc_id, change_ids)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async getAllRanges(req, res, next) {
    try {
      const { project_id } = req.params
      const ranges = await DocumentUpdaterHandler.promises.getProjectRanges(project_id)
      res.json(ranges)
    } catch (err) {
      next(err)
    }
  },
  async getChangesUsers(req, res, next) {
// This route was previously used by the frontend to retrieve names of users who made changes or comments.
// review-panel-new no longer needs this for comments, but still relies on it for changes -
// although the frontend knows the names of the current owner and members, it depends on the data
// provided here to assign names to authors who have left the project but still have unaccepted changes.
    try {
      const { project_id } = req.params
      const memberIds = await DocstoreManager.promises.getTrackedChangesUserIds(project_id)
      const limit = pLimit(3)
      const users = await Promise.all(
        memberIds.map(memberId =>
          limit(async () => {
            const user = await UserInfoManager.promises.getPersonalInfo(memberId)
            return UserInfoController.formatPersonalInfo(user)
          })
        )
      )
      res.json(users)
    } catch (err) {
      next(err)
    }
  },
  async getThreads(req, res, next) {
    try {
      const { project_id } = req.params
      const messages = await ChatApiHandler.promises.getThreads(project_id)
      await ChatManager.promises.injectUserInfoIntoThreads(messages)
      res.json(messages)
    } catch (err) {
      next(err)
    }
  },
  async sendComment(req, res, next) {
    try {
      const { project_id, thread_id } = req.params
      const { content } = req.body
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      const message = await ChatApiHandler.promises.sendComment(project_id, thread_id, user_id, content)
      const user = await UserInfoManager.promises.getPersonalInfo(user_id)
      message.user = UserInfoController.formatPersonalInfo(user)
      EditorRealTimeController.emitToRoom(project_id, 'new-comment', thread_id, message)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async editMessage(req, res, next) {
    try {
      const { project_id, thread_id, message_id } = req.params
      const { content } = req.body
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      // Only the author may edit their own message.
      const message = await ChatApiHandler.promises.getThreadMessage(project_id, thread_id, message_id)
      if (!message) {
        throw new NotFoundError('Message not found')
      }
      if (String(message.user_id) !== String(user_id)) {
        throw new ForbiddenError('Not allowed to edit this message', { user_id })
      }
      await ChatApiHandler.promises.editMessage(project_id, thread_id, message_id, user_id, content)
      EditorRealTimeController.emitToRoom(project_id, 'edit-message', thread_id, message_id, content)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async deleteMessage(req, res, next) {
    try {
      const { project_id, thread_id, message_id } = req.params
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      // Only the author may delete their own message.
      const message = await ChatApiHandler.promises.getThreadMessage(project_id, thread_id, message_id)
      if (!message) {
        throw new NotFoundError('Message not found')
      }
      if (String(message.user_id) !== String(user_id)) {
        throw new ForbiddenError('Not allowed to delete this message', { user_id })
      }
      await ChatApiHandler.promises.deleteUserMessage(project_id, thread_id, user_id, message_id)
      EditorRealTimeController.emitToRoom(project_id, 'delete-message', thread_id, message_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async resolveThread(req, res, next) {
    try {
      const { project_id, doc_id, thread_id } = req.params
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      const user = await UserInfoManager.promises.getPersonalInfo(user_id)
      await ChatApiHandler.promises.resolveThread(project_id, thread_id, user_id)
      EditorRealTimeController.emitToRoom(
        project_id,
        'resolve-thread',
        thread_id,
        UserInfoController.formatPersonalInfo(user)
      )
      await DocumentUpdaterHandler.promises.resolveThread(project_id, doc_id, thread_id, user_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async reopenThread(req, res, next) {
    try {
      const { project_id, doc_id, thread_id } = req.params
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      await ChatApiHandler.promises.reopenThread(project_id, thread_id)
      EditorRealTimeController.emitToRoom(project_id, 'reopen-thread', thread_id)
      await DocumentUpdaterHandler.promises.reopenThread(project_id, doc_id, thread_id, user_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async deleteThread(req, res, next) {
    try {
      const { project_id, doc_id, thread_id } = req.params
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      await ChatApiHandler.promises.deleteThread(project_id, thread_id)
      EditorRealTimeController.emitToRoom(project_id, 'delete-thread', thread_id)
      await DocumentUpdaterHandler.promises.deleteThread(project_id, doc_id, thread_id, user_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
}

export default TrackChangesController
