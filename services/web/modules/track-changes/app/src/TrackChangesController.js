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

async function _updateTCState (projectId, state, callback) {
  await Project.updateOne({_id: projectId}, {track_changes: state}).exec()
  callback()
}
function _transformId(doc) {
  if (doc._id) {
    doc.id = doc._id;
    delete doc._id;
  }
  return doc;
}

const TrackChangesController = {
  trackChanges(req, res, next) {
    const { project_id } = req.params
    let state = req.body.on || req.body.on_for
    if ( req.body.on_for_guests && !req.body.on ) state.__guests__ = true

    return _updateTCState(project_id, state,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
        EditorRealTimeController.emitToRoom(
          project_id,
          'toggle-track-changes',
          state
        )
        return res.sendStatus(204)
      }
    )
  },
  acceptChanges(req, res, next) {
    const { project_id, doc_id } = req.params
    const change_ids = req.body.change_ids
    return DocumentUpdaterHandler.acceptChanges(
      project_id,
      doc_id,
      change_ids,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
        EditorRealTimeController.emitToRoom(
          project_id,
          'accept-changes',
          doc_id,
          change_ids,
        )
        return res.sendStatus(204)
      }
    )
  },
  async getAllRanges(req, res, next) {
    const { project_id } = req.params
    // FIXME: ranges are from mongodb, probably already outdated
    const ranges = await DocstoreManager.promises.getAllRanges(project_id)
// frontend expects 'id', not '_id'
    return res.json(ranges.map(_transformId))
  },
  async getChangesUsers(req, res, next) {
    const { project_id } = req.params
    const memberIds = await CollaboratorsGetter.promises.getMemberIds(project_id)
    // FIXME: Does not work properly if the user is no longer a member of the project
    // memberIds from DocstoreManager.getAllRanges(project_id) is not a remedy
    // because ranges are not updated in real-time
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
// frontend expects 'id', not '_id'
    return res.json(users.map(_transformId))
  },
  getThreads(req, res, next) {
    const { project_id } = req.params
    return ChatApiHandler.getThreads(
      project_id,
      function (err, messages) {
        if (err != null) {
          return next(err)
        }
        return ChatManager.injectUserInfoIntoThreads(
          messages,
          function (err) {
            if (err != null) {
              return next(err)
            }
            return res.json(messages)
          }
        )
      }
    )
  },
  sendComment(req, res, next) {
    const { project_id, thread_id } = req.params
    const { content } = req.body
    const user_id = SessionManager.getLoggedInUserId(req.session)
    if (user_id == null) {
      const err = new Error('no logged-in user')
      return next(err)
    }
    return ChatApiHandler.sendComment(
      project_id,
      thread_id,
      user_id,
      content,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
        return UserInfoManager.getPersonalInfo(
          user_id,
          function (err, user) {
            if (err != null) {
              return next(err)
            }
            message.user = user
            EditorRealTimeController.emitToRoom(
              project_id,
              'new-comment',
              thread_id, message
            )
            return res.sendStatus(204)
          }
        )
      }
    )
  },
  editMessage(req, res, next) {
    const { project_id, thread_id, message_id } = req.params
    const { content } = req.body
    const user_id = SessionManager.getLoggedInUserId(req.session)
    if (user_id == null) {
      const err = new Error('no logged-in user')
      return next(err)
    }
    return ChatApiHandler.editMessage(
      project_id,
      thread_id,
      message_id,
      user_id,
      content,
      function (err, message) {
        if (err != null) {
            return next(err)
        }
        EditorRealTimeController.emitToRoom(
          project_id,
          'edit-message',
          thread_id,
          message_id,
          content
        )
        return res.sendStatus(204)
      }
    )
  },
  deleteMessage(req, res, next) {
    const { project_id, thread_id, message_id } = req.params
    return ChatApiHandler.deleteMessage(
      project_id,
      thread_id,
      message_id,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
        EditorRealTimeController.emitToRoom(
          project_id,
          'delete-message',
          thread_id,
          message_id
        )
        return res.sendStatus(204)
      }
    )
  },
  resolveThread(req, res, next) {
    const { project_id, doc_id, thread_id } = req.params
    const user_id = SessionManager.getLoggedInUserId(req.session)
    if (user_id == null) {
      const err = new Error('no logged-in user')
      return next(err)
    }
    DocumentUpdaterHandler.resolveThread(
      project_id,
      doc_id,
      thread_id,
      user_id,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
      }
    )
    return ChatApiHandler.resolveThread(
      project_id,
      thread_id,
      user_id,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
        return UserInfoManager.getPersonalInfo(
          user_id,
          function (err, user) {
            if (err != null) {
              return next(err)
            }
            EditorRealTimeController.emitToRoom(
              project_id,
              'resolve-thread',
              thread_id,
              user
            )
            return res.sendStatus(204)
          }
        )
      }
    )
  },
  reopenThread(req, res, next) {
    const { project_id, doc_id, thread_id } = req.params
    const user_id = SessionManager.getLoggedInUserId(req.session)
    if (user_id == null) {
      const err = new Error('no logged-in user')
      return next(err)
    }
    DocumentUpdaterHandler.reopenThread(
      project_id,
      doc_id,
      thread_id,
      user_id,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
      }
    )
    return ChatApiHandler.reopenThread(
      project_id,
      thread_id,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
        EditorRealTimeController.emitToRoom(
          project_id,
          'reopen-thread',
          thread_id
        )
        return res.sendStatus(204)
      }
    )
  },
  deleteThread(req, res, next) {
    const { project_id, doc_id, thread_id } = req.params
    const user_id = SessionManager.getLoggedInUserId(req.session)
    if (user_id == null) {
      const err = new Error('no logged-in user')
      return next(err)
    }
    return DocumentUpdaterHandler.deleteThread(
      project_id,
      doc_id,
      thread_id,
      user_id,
      function (err, message) {
        if (err != null) {
          return next(err)
        }
        ChatApiHandler.deleteThread(
          project_id,
          thread_id,
          function (err, message) {
            if (err != null) {
              return next(err)
            }
            EditorRealTimeController.emitToRoom(
              project_id,
              'delete-thread',
              thread_id
            )
            return res.sendStatus(204)
          }
        )
      }
    )
  },
}
module.exports = TrackChangesController
