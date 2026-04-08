import { Project } from '../../../../app/src/models/Project.mjs'
import ProjectWebDAVSync from './ProjectWebDAVSync.mjs'
import Logger from '@overleaf/logger'

const DEFAULT_SYNC_INTERVAL_MS = 30 * 1000
const SYNC_DEBOUNCE_MS = 5 * 1000

const pendingSyncs = new Map()
const syncInProgress = new Map()

const ProjectWebDAVAutoSync = {
    getSyncInterval() {
        return process.env.WEBDAV_SYNC_INTERVAL_MS
            ? parseInt(process.env.WEBDAV_SYNC_INTERVAL_MS, 10)
            : DEFAULT_SYNC_INTERVAL_MS
    },

    async markPendingSync(projectId, isBinaryChange = false) {
        const projectIdStr = projectId.toString()

        try {
            const project = await Project.findById(projectId, { webdavConfig: 1 }).exec()
            if (!project?.webdavConfig?.enabled) return

            const existing = pendingSyncs.get(projectIdStr) || {
                timer: null,
                hasPendingChanges: false,
                isBinaryChange: false,
                lastModifiedAt: null,
            }

            existing.hasPendingChanges = true
            existing.lastModifiedAt = new Date()

            if (isBinaryChange) {
                existing.isBinaryChange = true
            }

            if (existing.timer) {
                clearTimeout(existing.timer)
                existing.timer = null
            }

            if (existing.isBinaryChange) {
                pendingSyncs.set(projectIdStr, existing)
                await this.triggerSync(projectIdStr)
                return
            }

            const lastSyncDate = project.webdavConfig.lastSyncDate
            const syncInterval = this.getSyncInterval()
            const now = Date.now()

            if (lastSyncDate && (now - new Date(lastSyncDate).getTime()) >= syncInterval) {
                existing.timer = setTimeout(() => {
                    this.triggerSync(projectIdStr).catch(err => {
                        Logger.warn({ err, projectId: projectIdStr }, 'Background WebDAV sync failed')
                    })
                }, SYNC_DEBOUNCE_MS)
            } else {
                const timeUntilSync = lastSyncDate
                    ? Math.max(syncInterval - (now - new Date(lastSyncDate).getTime()), SYNC_DEBOUNCE_MS)
                    : SYNC_DEBOUNCE_MS

                existing.timer = setTimeout(() => {
                    this.triggerSync(projectIdStr).catch(err => {
                        Logger.warn({ err, projectId: projectIdStr }, 'Background WebDAV sync failed')
                    })
                }, timeUntilSync)
            }

            pendingSyncs.set(projectIdStr, existing)
        } catch (err) {
            Logger.warn({ err, projectId: projectIdStr }, 'Error in markPendingSync')
        }
    },

    async triggerSync(projectId) {
        const projectIdStr = projectId.toString()

        if (syncInProgress.has(projectIdStr)) {
            try {
                await syncInProgress.get(projectIdStr)
            } catch (err) {
                // Previous sync failed, continue with new sync
            }
        }

        const pending = pendingSyncs.get(projectIdStr)
        if (!pending?.hasPendingChanges) {
            return false
        }

        const syncPromise = (async () => {
            try {
                Logger.info({ projectId: projectIdStr }, 'Starting automatic WebDAV sync')
                await ProjectWebDAVSync.syncAllProjectFiles(projectId)

                const state = pendingSyncs.get(projectIdStr)
                if (state) {
                    if (state.timer) clearTimeout(state.timer)
                    pendingSyncs.delete(projectIdStr)
                }

                Logger.info({ projectId: projectIdStr }, 'Automatic WebDAV sync completed')
                return true
            } catch (err) {
                Logger.error({ err, projectId: projectIdStr }, 'Automatic WebDAV sync failed')
                throw err
            } finally {
                syncInProgress.delete(projectIdStr)
            }
        })()

        syncInProgress.set(projectIdStr, syncPromise)
        return syncPromise
    },

    async syncOnProjectClose(projectId) {
        const projectIdStr = projectId.toString()

        try {
            const pending = pendingSyncs.get(projectIdStr)
            if (!pending?.hasPendingChanges) return

            const project = await Project.findById(projectId, { webdavConfig: 1 }).exec()
            if (!project?.webdavConfig?.enabled) return

            Logger.info({ projectId: projectIdStr }, 'Syncing to WebDAV on project close')

            setImmediate(async () => {
                try {
                    await this.triggerSync(projectIdStr)
                } catch (err) {
                    Logger.error({ err, projectId: projectIdStr }, 'WebDAV sync on project close failed')
                }
            })
        } catch (err) {
            Logger.warn({ err, projectId: projectIdStr }, 'Error in syncOnProjectClose')
        }
    },

    async forceSync(projectId) {
        const projectIdStr = projectId.toString()

        const existing = pendingSyncs.get(projectIdStr) || {
            timer: null,
            hasPendingChanges: true,
            isBinaryChange: false,
            lastModifiedAt: new Date(),
        }
        existing.hasPendingChanges = true
        pendingSyncs.set(projectIdStr, existing)

        return this.triggerSync(projectIdStr)
    },

    hasPendingChanges(projectId) {
        const pending = pendingSyncs.get(projectId.toString())
        return pending?.hasPendingChanges || false
    },

    cancelPendingSync(projectId) {
        const projectIdStr = projectId.toString()
        const pending = pendingSyncs.get(projectIdStr)
        if (pending?.timer) clearTimeout(pending.timer)
        pendingSyncs.delete(projectIdStr)
    },
}

export default ProjectWebDAVAutoSync
