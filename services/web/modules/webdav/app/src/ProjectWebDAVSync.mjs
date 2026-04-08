import { Project } from '../../../../app/src/models/Project.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import Logger from '@overleaf/logger'
import crypto from 'crypto'

// Dynamic import for WebDAV client
let webdavModule = null
async function getWebDAVClient() {
    if (!webdavModule) {
        webdavModule = await import('webdav')
    }
    return webdavModule.createClient
}

// Helper functions to encode/decode file paths for MongoDB storage
// MongoDB doesn't allow dots (.) or dollar signs ($) in field names
function encodePathForStorage(path) {
    return path
        .replace(/%/g, '%25')
        .replace(/\./g, '%2E')
        .replace(/\$/g, '%24')
}

function decodePathFromStorage(encodedPath) {
    return encodedPath
        .replace(/%24/g, '$')
        .replace(/%2E/g, '.')
        .replace(/%25/g, '%')
}

const ProjectWebDAVSync = {
    async getWebDAVConfig(projectId) {
        const project = await Project.findById(projectId, { webdavConfig: 1 }).lean().exec()
        if (!project?.webdavConfig?.enabled) {
            return null
        }
        return project.webdavConfig
    },

    async createClient(config) {
        const createClient = await getWebDAVClient()
        return createClient(config.url, {
            username: config.username,
            password: config.password,
        })
    },

    async ensureDirectoryExists(client, dirPath, basePath) {
        const fullPath = `${basePath}${dirPath}`
        const parts = fullPath.split('/').filter(p => p)
        let currentPath = ''

        for (const part of parts) {
            currentPath += '/' + part
            try {
                const exists = await client.exists(currentPath)
                if (!exists) {
                    await client.createDirectory(currentPath)
                }
            } catch (err) {
                if (!err.message?.includes('405')) {
                    Logger.warn({ err, path: currentPath }, 'Error creating directory')
                }
            }
        }
    },

    async syncDocument(projectId, docId, docPath, content) {
        try {
            const config = await this.getWebDAVConfig(projectId)
            if (!config) return

            const client = await this.createClient(config)
            const basePath = config.basePath || '/overleaf'
            const remotePath = `${basePath}${docPath}`

            const parentDir = docPath.substring(0, docPath.lastIndexOf('/'))
            if (parentDir) {
                await this.ensureDirectoryExists(client, parentDir, basePath)
            }

            await client.putFileContents(remotePath, content)
            Logger.info({ projectId, docPath, remotePath }, 'Document synced to WebDAV')
        } catch (err) {
            Logger.warn({ err, projectId, docPath }, 'Failed to sync document to WebDAV')
        }
    },

    async syncFile(projectId, fileId, filePath, fileStream) {
        try {
            const config = await this.getWebDAVConfig(projectId)
            if (!config) return

            const client = await this.createClient(config)
            const basePath = config.basePath || '/overleaf'
            const remotePath = `${basePath}${filePath}`

            const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
            if (parentDir) {
                await this.ensureDirectoryExists(client, parentDir, basePath)
            }

            await client.putFileContents(remotePath, fileStream)
            Logger.info({ projectId, filePath, remotePath }, 'File synced to WebDAV')
        } catch (err) {
            Logger.warn({ err, projectId, filePath }, 'Failed to sync file to WebDAV')
        }
    },

    async syncAllProjectFiles(projectId, force = false) {
        try {
            const config = await this.getWebDAVConfig(projectId)
            if (!config) {
                Logger.info({ projectId }, 'No WebDAV config, skipping sync')
                return
            }

            Logger.info({ projectId, force }, 'Starting full project sync to WebDAV')

            const project = await ProjectGetter.promises.getProject(projectId, {
                rootFolder: true,
                name: true,
                lastUpdated: true,
            })

            if (!project) {
                Logger.warn({ projectId }, 'Project not found for WebDAV sync')
                return
            }

            const projectLastUpdated = project.lastUpdated ? new Date(project.lastUpdated) : null
            const lastSyncDate = config.lastSyncDate ? new Date(config.lastSyncDate) : null
            const storedHashes = config.syncedFileHashes || {}

            if (!force && projectLastUpdated && lastSyncDate && projectLastUpdated <= lastSyncDate) {
                Logger.info({ projectId, projectLastUpdated, lastSyncDate },
                    'Project not modified since last sync, skipping')
                return
            }

            const { docs, files } = ProjectEntityHandler.getAllEntitiesFromProject(project)
            const client = await this.createClient(config)
            const basePath = config.basePath || '/overleaf'
            const syncStartTime = new Date()

            try {
                const exists = await client.exists(basePath)
                if (!exists) {
                    await client.createDirectory(basePath)
                }
            } catch (err) {
                Logger.warn({ err, basePath }, 'Could not create basePath directory')
            }

            let syncedDocsCount = 0
            let skippedDocsCount = 0
            let syncedFilesCount = 0
            let skippedFilesCount = 0
            const updatedHashes = { ...storedHashes }

            for (const { path: docPath, doc } of docs) {
                try {
                    const docData = await DocstoreManager.promises.getDoc(
                        projectId.toString(),
                        doc._id.toString()
                    )
                    const content = docData.lines.join('\n')
                    const contentHash = crypto.createHash('md5').update(content).digest('hex')
                    const encodedDocPath = encodePathForStorage(docPath)
                    const previousHash = storedHashes[encodedDocPath]

                    if (previousHash && previousHash === contentHash) {
                        skippedDocsCount++
                        continue
                    }

                    const remotePath = `${basePath}${docPath}`
                    const parentDir = docPath.substring(0, docPath.lastIndexOf('/'))
                    if (parentDir) {
                        await this.ensureDirectoryExists(client, parentDir, basePath)
                    }

                    await client.putFileContents(remotePath, content, { overwrite: true })
                    updatedHashes[encodedDocPath] = contentHash
                    syncedDocsCount++
                } catch (err) {
                    Logger.warn({ err, projectId, docPath }, 'Failed to sync document')
                }
            }

            for (const { path: filePath, file } of files) {
                try {
                    if (!file.hash) {
                        Logger.warn({ projectId, filePath, fileId: file._id }, 'File missing hash, skipping')
                        continue
                    }

                    const currentHash = file.hash
                    const encodedFilePath = encodePathForStorage(filePath)
                    const previousHash = storedHashes[encodedFilePath]

                    if (previousHash && previousHash === currentHash) {
                        skippedFilesCount++
                        continue
                    }

                    const { stream } = await HistoryManager.promises.requestBlobWithProjectId(
                        projectId.toString(),
                        file.hash
                    )

                    const chunks = []
                    for await (const chunk of stream) {
                        chunks.push(chunk)
                    }
                    const buffer = Buffer.concat(chunks)

                    const remotePath = `${basePath}${filePath}`
                    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
                    if (parentDir) {
                        await this.ensureDirectoryExists(client, parentDir, basePath)
                    }

                    await client.putFileContents(remotePath, buffer, { overwrite: true })
                    updatedHashes[encodedFilePath] = currentHash
                    syncedFilesCount++
                } catch (err) {
                    Logger.warn({ err, projectId, filePath }, 'Failed to sync file')
                }
            }

            await Project.updateOne(
                { _id: projectId },
                {
                    $set: {
                        'webdavConfig.lastSyncDate': syncStartTime,
                        'webdavConfig.syncedFileHashes': updatedHashes
                    }
                }
            ).exec()

            Logger.info({
                projectId,
                syncedDocsCount,
                skippedDocsCount,
                syncedFilesCount,
                skippedFilesCount,
                totalDocs: docs.length,
                totalFiles: files.length
            }, 'Full project sync to WebDAV completed')
        } catch (err) {
            Logger.error({ err, projectId }, 'Failed to sync project to WebDAV')
            throw err
        }
    },

    async deleteFromWebDAV(projectId, filePath) {
        try {
            const config = await this.getWebDAVConfig(projectId)
            if (!config) return

            const client = await this.createClient(config)
            const basePath = config.basePath || '/overleaf'
            const remotePath = `${basePath}${filePath}`

            try {
                await client.deleteFile(remotePath)
                Logger.info({ projectId, filePath, remotePath }, 'File deleted from WebDAV')
            } catch (err) {
                if (err.status !== 404) throw err
            }

            const encodedPath = encodePathForStorage(filePath)
            await Project.updateOne(
                { _id: projectId },
                { $unset: { [`webdavConfig.syncedFileHashes.${encodedPath}`]: '' } }
            ).exec()
        } catch (err) {
            Logger.warn({ err, projectId, filePath }, 'Failed to delete file from WebDAV')
        }
    },

    async moveOnWebDAV(projectId, oldPath, newPath) {
        try {
            const config = await this.getWebDAVConfig(projectId)
            if (!config) return

            const client = await this.createClient(config)
            const basePath = config.basePath || '/overleaf'
            const oldRemotePath = `${basePath}${oldPath}`
            const newRemotePath = `${basePath}${newPath}`

            const parentDir = newPath.substring(0, newPath.lastIndexOf('/'))
            if (parentDir) {
                await this.ensureDirectoryExists(client, parentDir, basePath)
            }

            try {
                await client.moveFile(oldRemotePath, newRemotePath)
                Logger.info({ projectId, oldPath, newPath }, 'File moved on WebDAV')
            } catch (err) {
                if (err.status === 404) {
                    Logger.warn({ projectId, oldPath }, 'Source file not found for move')
                } else {
                    throw err
                }
            }

            const storedHashes = config.syncedFileHashes || {}
            const encodedOldPath = encodePathForStorage(oldPath)
            const encodedNewPath = encodePathForStorage(newPath)
            const hash = storedHashes[encodedOldPath]
            if (hash) {
                delete storedHashes[encodedOldPath]
                storedHashes[encodedNewPath] = hash
                await Project.updateOne(
                    { _id: projectId },
                    { $set: { 'webdavConfig.syncedFileHashes': storedHashes } }
                ).exec()
            }
        } catch (err) {
            Logger.warn({ err, projectId, oldPath, newPath }, 'Failed to move file on WebDAV')
        }
    },

    async deleteAllFromWebDAV(projectId) {
        try {
            const config = await this.getWebDAVConfig(projectId)
            if (!config) {
                Logger.info({ projectId }, 'No WebDAV config, cannot delete remote content')
                return
            }

            const client = await this.createClient(config)
            const basePath = config.basePath || '/overleaf'

            Logger.info({ projectId, basePath }, 'Deleting all project files from WebDAV')

            const exists = await client.exists(basePath)
            if (!exists) {
                Logger.info({ projectId, basePath }, 'WebDAV directory does not exist')
                return
            }

            try {
                await client.deleteFile(basePath)
                Logger.info({ projectId, basePath }, 'Deleted WebDAV directory (direct)')
                return
            } catch (directDeleteErr) {
                if (directDeleteErr.status === 404) return
                Logger.info({ projectId, basePath }, 'Direct deletion failed, trying recursive')
            }

            try {
                const contents = await client.getDirectoryContents(basePath, { deep: true })
                contents.sort((a, b) => b.filename.length - a.filename.length)
                for (const item of contents) {
                    try {
                        await client.deleteFile(item.filename)
                    } catch (deleteErr) {
                        if (deleteErr.status !== 404) {
                            Logger.warn({ err: deleteErr, projectId, path: item.filename }, 'Failed to delete item from WebDAV')
                        }
                    }
                }
                try {
                    await client.deleteFile(basePath)
                } catch (deleteErr) {
                    if (deleteErr.status !== 404) {
                        Logger.warn({ err: deleteErr, projectId, basePath }, 'Failed to delete base directory')
                    }
                }
            } catch (err) {
                if (err.status !== 404) throw err
            }
        } catch (err) {
            Logger.error({ err, projectId }, 'Failed to delete all files from WebDAV')
            throw err
        }
    },
}

export default ProjectWebDAVSync
