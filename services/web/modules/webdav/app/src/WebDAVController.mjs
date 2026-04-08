import { z } from 'zod'
import Logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import ProjectWebDAVSync from './ProjectWebDAVSync.mjs'
import ProjectWebDAVAutoSync from './ProjectWebDAVAutoSync.mjs'

const webdavConfigSchema = z.object({
    url: z.string().url().max(1024),
    username: z.string().max(256).optional().default(''),
    password: z.string().max(256).optional().default(''),
    basePath: z.string().max(512).optional().default('/overleaf'),
    useUsername: z.boolean().optional(),
    usePassword: z.boolean().optional(),
})

const linkWebDAVSchema = z.object({
    webdavConfig: webdavConfigSchema,
})

async function linkWebDAV(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    try {
        const body = linkWebDAVSchema.parse(req.body)
        const { webdavConfig: inputConfig } = body

        // Get existing config to preserve credentials if not provided
        const existingProject = await Project.findById(projectId, { webdavConfig: 1 }).lean().exec()
        const existingConfig = existingProject?.webdavConfig

        const configToSave = {
            url: inputConfig.url,
            basePath: inputConfig.basePath || '/overleaf',
            enabled: true,
            lastSyncDate: existingConfig?.lastSyncDate || null,
            syncedFileHashes: existingConfig?.syncedFileHashes || {},
        }

        // Handle username
        if (inputConfig.useUsername === false) {
            configToSave.username = ''
        } else if (inputConfig.username) {
            configToSave.username = inputConfig.username
        } else if (existingConfig?.username) {
            configToSave.username = existingConfig.username
        } else {
            configToSave.username = ''
        }

        // Handle password
        if (inputConfig.usePassword === false) {
            configToSave.password = ''
        } else if (inputConfig.password) {
            configToSave.password = inputConfig.password
        } else if (existingConfig?.password) {
            configToSave.password = existingConfig.password
        } else {
            configToSave.password = ''
        }

        // Test connection by checking if base path is accessible
        const { createClient } = await import('webdav')
        const testClient = createClient(configToSave.url, {
            username: configToSave.username,
            password: configToSave.password,
        })

        try {
            const exists = await testClient.exists(configToSave.basePath)
            if (!exists) {
                await testClient.createDirectory(configToSave.basePath, { recursive: true })
            }

            // Check if directory is empty (for first-time linking)
            if (!existingConfig?.enabled) {
                const contents = await testClient.getDirectoryContents(configToSave.basePath)
                if (contents.length > 0) {
                    return res.status(400).json({
                        message: 'webdav_directory_not_empty'
                    })
                }
            }
        } catch (connErr) {
            Logger.warn({ err: connErr, projectId }, 'WebDAV connection test failed')
            return res.status(400).json({
                message: 'webdav_connection_failed'
            })
        }

        await Project.updateOne(
            { _id: projectId },
            { $set: { webdavConfig: configToSave } }
        ).exec()

        Logger.info({ projectId, userId }, 'WebDAV linked to project')

        // Trigger initial sync in background
        ProjectWebDAVAutoSync.forceSync(projectId).catch(err => {
            Logger.warn({ err, projectId }, 'Initial WebDAV sync failed')
        })

        res.json({ success: true })
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ message: 'Invalid WebDAV configuration', errors: err.errors })
        }
        Logger.error({ err, projectId }, 'Failed to link WebDAV')
        res.status(500).json({ message: 'Failed to link WebDAV' })
    }
}

async function unlinkWebDAV(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    const deleteRemoteContent = req.body.deleteRemoteContent === true

    try {
        if (deleteRemoteContent) {
            await ProjectWebDAVSync.deleteAllFromWebDAV(projectId)
        }

        ProjectWebDAVAutoSync.cancelPendingSync(projectId)

        await Project.updateOne(
            { _id: projectId },
            { $unset: { webdavConfig: '' } }
        ).exec()

        Logger.info({ projectId, userId, deleteRemoteContent }, 'WebDAV unlinked from project')
        res.json({ success: true })
    } catch (err) {
        Logger.error({ err, projectId }, 'Failed to unlink WebDAV')
        res.status(500).json({ message: 'Failed to unlink WebDAV' })
    }
}

async function syncWebDAV(req, res) {
    const projectId = req.params.Project_id

    try {
        await ProjectWebDAVSync.syncAllProjectFiles(projectId, true)
        res.json({ success: true })
    } catch (err) {
        Logger.error({ err, projectId }, 'Failed to sync WebDAV')
        res.status(500).json({ message: 'Failed to sync WebDAV' })
    }
}

async function getWebDAVConfig(req, res) {
    const projectId = req.params.Project_id

    try {
        const project = await Project.findById(projectId, { webdavConfig: 1 }).lean().exec()
        if (!project?.webdavConfig?.enabled) {
            return res.json({ webdavConfig: null })
        }

        // Don't expose credentials
        const safeConfig = {
            url: project.webdavConfig.url,
            basePath: project.webdavConfig.basePath,
            enabled: project.webdavConfig.enabled,
            lastSyncDate: project.webdavConfig.lastSyncDate,
            hasUsername: !!project.webdavConfig.username,
            hasPassword: !!project.webdavConfig.password,
        }

        res.json({ webdavConfig: safeConfig })
    } catch (err) {
        Logger.error({ err, projectId }, 'Failed to get WebDAV config')
        res.status(500).json({ message: 'Failed to get WebDAV config' })
    }
}

// Internal API endpoint called by real-time service when project closes
async function leaveProject(req, res) {
    const projectId = req.params.project_id
    const { isLastClient } = req.body

    if (isLastClient) {
        ProjectWebDAVAutoSync.syncOnProjectClose(projectId).catch(err => {
            Logger.warn({ err, projectId }, 'WebDAV sync on project close failed')
        })
    }

    res.sendStatus(204)
}

const WebDAVController = {
    linkWebDAV,
    unlinkWebDAV,
    syncWebDAV,
    getWebDAVConfig,
    leaveProject,
}

export default WebDAVController
