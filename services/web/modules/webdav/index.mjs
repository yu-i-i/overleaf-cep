import Logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import AuthorizationMiddleware from '../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../app/src/Features/Authentication/AuthenticationController.mjs'
import RateLimiterMiddleware from '../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../app/src/infrastructure/RateLimiter.mjs'
import { ProjectSchema } from '../../app/src/models/Project.mjs'
import WebDAVController from './app/src/WebDAVController.mjs'
import ProjectWebDAVSync from './app/src/ProjectWebDAVSync.mjs'
import ProjectWebDAVAutoSync from './app/src/ProjectWebDAVAutoSync.mjs'
import mongoose from '../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose

Logger.debug({}, 'Loading webdav module')

// Extend the Project schema with webdavConfig
ProjectSchema.add({
    webdavConfig: {
        url: { type: String },
        username: { type: String },
        password: { type: String },
        basePath: { type: String, default: '/overleaf' },
        enabled: { type: Boolean, default: false },
        lastSyncDate: { type: Date },
        syncedFileHashes: { type: Schema.Types.Mixed, default: {} },
    },
})

const rateLimiters = {
    webdavLink: new RateLimiter('webdav-link', {
        points: 10,
        duration: 60,
    }),
    webdavSync: new RateLimiter('webdav-sync', {
        points: 5,
        duration: 60,
    }),
}

const WebDAVModule = {
    router: {
        apply(webRouter, privateApiRouter) {
            // Public routes (require authentication + CSRF)
            webRouter.post(
                '/project/:Project_id/webdav/link',
                AuthenticationController.requireLogin(),
                AuthorizationMiddleware.ensureUserCanAdminProject,
                RateLimiterMiddleware.rateLimit(rateLimiters.webdavLink),
                expressify(WebDAVController.linkWebDAV)
            )

            webRouter.post(
                '/project/:Project_id/webdav/unlink',
                AuthenticationController.requireLogin(),
                AuthorizationMiddleware.ensureUserCanAdminProject,
                RateLimiterMiddleware.rateLimit(rateLimiters.webdavLink),
                expressify(WebDAVController.unlinkWebDAV)
            )

            webRouter.post(
                '/project/:Project_id/webdav/sync',
                AuthenticationController.requireLogin(),
                AuthorizationMiddleware.ensureUserCanAdminProject,
                RateLimiterMiddleware.rateLimit(rateLimiters.webdavSync),
                expressify(WebDAVController.syncWebDAV)
            )

            webRouter.get(
                '/project/:Project_id/webdav/config',
                AuthenticationController.requireLogin(),
                AuthorizationMiddleware.ensureUserCanAdminProject,
                expressify(WebDAVController.getWebDAVConfig)
            )

            // Internal API route for real-time service
            if (privateApiRouter) {
                privateApiRouter.post(
                    '/project/:project_id/leave',
                    expressify(WebDAVController.leaveProject)
                )
            }
        },
    },

    hooks: {
        promises: {
            // Hook: called after project entity is updated (file add/replace)
            projectFileAdded: async (projectId) => {
                try {
                    await ProjectWebDAVAutoSync.markPendingSync(projectId, true)
                } catch (err) {
                    Logger.warn({ err, projectId }, 'WebDAV: error in projectFileAdded hook')
                }
            },

            // Hook: called after project entity is deleted
            projectEntityDeleted: async (projectId, entityPath) => {
                try {
                    await ProjectWebDAVSync.deleteFromWebDAV(projectId, entityPath)
                    await ProjectWebDAVAutoSync.markPendingSync(projectId, false)
                } catch (err) {
                    Logger.warn({ err, projectId }, 'WebDAV: error in projectEntityDeleted hook')
                }
            },

            // Hook: called after project entity is moved/renamed
            projectEntityMoved: async (projectId, oldPath, newPath) => {
                try {
                    await ProjectWebDAVSync.moveOnWebDAV(projectId, oldPath, newPath)
                    await ProjectWebDAVAutoSync.markPendingSync(projectId, false)
                } catch (err) {
                    Logger.warn({ err, projectId }, 'WebDAV: error in projectEntityMoved hook')
                }
            },

            // Hook: called when project is updated (document edit)
            projectUpdated: async (projectId) => {
                try {
                    await ProjectWebDAVAutoSync.markPendingSync(projectId, false)
                } catch (err) {
                    // Ignore - best effort background operation
                }
            },
        },
    },
}

export default WebDAVModule
