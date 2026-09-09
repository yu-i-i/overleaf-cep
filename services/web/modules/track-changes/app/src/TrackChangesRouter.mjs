import logger from '@overleaf/logger'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import TrackChangesController from './TrackChangesController.mjs'

const rateLimiterReads = new RateLimiter('track-changes-reads', { points: 60, duration: 60 })
const rateLimiterWrites = new RateLimiter('track-changes-writes', { points: 20, duration: 60 })

export default {
  apply(webRouter) {
    logger.debug({}, 'Init track-changes router')

    webRouter.post(
      '/project/:project_id/track_changes',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.trackChanges
    )
    webRouter.post(
      '/project/:project_id/doc/:doc_id/changes/accept',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      // Accepting changes mutates the document: an editor, not a reader.
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.acceptChanges
    )
    webRouter.get(
      '/project/:project_id/ranges',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterReads),
      TrackChangesController.getAllRanges
    )
    webRouter.get(
      '/project/:project_id/changes/users',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterReads),
      TrackChangesController.getChangesUsers
    )
    webRouter.get(
      '/project/:project_id/threads',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterReads),
      TrackChangesController.getThreads
    )
    webRouter.post(
      '/project/:project_id/thread/:thread_id/messages',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.sendComment
    )
    webRouter.post(
      '/project/:project_id/thread/:thread_id/messages/:message_id/edit',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.editMessage
    )
    webRouter.delete(
      '/project/:project_id/thread/:thread_id/messages/:message_id',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.deleteMessage
    )
    webRouter.post(
      '/project/:project_id/doc/:doc_id/thread/:thread_id/resolve',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.resolveThread
    )
    webRouter.post(
      '/project/:project_id/doc/:doc_id/thread/:thread_id/reopen',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.reopenThread
    )
    webRouter.delete(
      '/project/:project_id/doc/:doc_id/thread/:thread_id',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      // Deleting a thread removes content for everyone: an editor action.
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      TrackChangesController.deleteThread
    )
  }
}
