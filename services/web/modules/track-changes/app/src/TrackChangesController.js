const ChatApiHandler = require('../../../../app/src/Features/Chat/ChatApiHandler')
const ChatManager = require('../../../../app/src/Features/Chat/ChatManager')
const EditorRealTimeController = require('../../../../app/src/Features/Editor/EditorRealTimeController')
const SessionManager = require('../../../../app/src/Features/Authentication/SessionManager')
const UserInfoManager = require('../../../../app/src/Features/User/UserInfoManager')
const DocstoreManager = require('../../../../app/src/Features/Docstore/DocstoreManager')
const DocumentUpdaterHandler = require('../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler')
const CollaboratorsGetter = require('../../../../app/src/Features/Collaborators/CollaboratorsGetter')
const { Project } = require('../../../../app/src/models/Project')
const pLimit = require('p-limit')

function _transformId(doc) {
  if (doc._id) {
    doc.id = doc._id;
    delete doc._id;
  }
  return doc;
}

const TrackChangesController = {
  async trackChanges(req, res, next) {
    try {
      const { project_id } = req.params
      let state = req.body.on || req.body.on_for
      if (req.body.on_for_guests && !req.body.on) state.__guests__ = true
      await Project.updateOne({_id: project_id}, {track_changes: state}).exec()  //do not wait?
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
      EditorRealTimeController.emitToRoom(project_id, 'accept-changes', doc_id, change_ids)
      await DocumentUpdaterHandler.promises.acceptChanges(project_id, doc_id, change_ids)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async getAllRanges(req, res, next) {
    try {
      const { project_id } = req.params
      // Flushing the project to mongo is not ideal. Is it possible to fetch the ranges from redis?
      await DocumentUpdaterHandler.promises.flushProjectToMongo(project_id)
      const ranges = await DocstoreManager.promises.getAllRanges(project_id)
      res.json(ranges.map(_transformId))
    } catch (err) {
      next(err)
    }
  },
  async getChangesUsers(req, res, next) {
    try {
      const { project_id } = req.params
      const memberIds = await CollaboratorsGetter.promises.getMemberIds(project_id)
      // FIXME: Fails to display names in changes made by former project collaborators.
      // See the alternative below. However, it requires flushing the project to mongo, which is not ideal.
      const limit = pLimit(3)
      const users = await Promise.all(
        memberIds.map(memberId =>
          limit(async () => {
            const user = await UserInfoManager.promises.getPersonalInfo(memberId)
            return user
          })
        )
      )
      users.push({_id: null}) // An anonymous user won't cause any harm
      res.json(users.map(_transformId))
    } catch (err) {
      next(err)
    }
  },
/*
  async getChangesUsers(req, res, next) {
    try {
      const { project_id } = req.params
      await DocumentUpdaterHandler.promises.flushProjectToMongo(project_id)
      const memberIds = new Set()
      const ranges = await DocstoreManager.promises.getAllRanges(project_id)
      ranges.forEach(range => {
        ;[...range.ranges?.changes || [], ...range.ranges?.comments || []].forEach(item => {
          memberIds.add(item.metadata?.user_id)
        })
      })
      const limit = pLimit(3)
      const users = await Promise.all(
        [...memberIds].map(memberId =>
          limit(async () => {
	    if( memberId !== "anonymous-user") {
              return await UserInfoManager.promises.getPersonalInfo(memberId)
	    } else {
	      return {_id: null}
	    }
          })
        )
      )
      res.json(users.map(_transformId))
    } catch (err) {
      next(err)
    }
  },
*/
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
      message.user = await UserInfoManager.promises.getPersonalInfo(user_id)
      EditorRealTimeController.emitToRoom(project_id, 'new-comment', thread_id, message)
      res.sendStatus(204)
    } catch (err) {
      next(err);
    }
  },
  async editMessage(req, res, next) {
    try {
      const { project_id, thread_id, message_id } = req.params
      const { content } = req.body
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
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
      await ChatApiHandler.promises.deleteMessage(project_id, thread_id, message_id)
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
      EditorRealTimeController.emitToRoom(project_id, 'resolve-thread', thread_id, user)
      await DocumentUpdaterHandler.promises.resolveThread(project_id, doc_id, thread_id, user_id)
      res.sendStatus(204);
    } catch (err) {
      next(err);
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
module.exports = TrackChangesController
