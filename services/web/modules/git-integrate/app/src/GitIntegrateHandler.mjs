/**
 * Business logic for git-integrate.
 *
 * Reads project documents and files from Overleaf's internal services
 * (DocstoreManager via ProjectEntityHandler and HistoryManager for blobs) and
 * commits them to the configured external Git repository.
 *
 * The push produces a single git commit containing every doc and binary file
 * in the project, mirroring the project structure exactly.  Binary files are
 * streamed from the history blob store and converted to Buffers before being
 * sent to the Git provider.
 *
 * Design follows TeXlyre's GitHubBackupService synchronize() approach
 * (texlyre/extras/backup/github/GitHubBackupService.ts, MIT Licence,
 *  Copyright (c) TeXlyre contributors) but routes file access through
 * Overleaf's server-side APIs rather than the browser's file-storage layer.
 */

import { Readable } from 'node:stream'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import logger from '@overleaf/logger'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectEntityUpdateHandler from '../../../../app/src/Features/Project/ProjectEntityUpdateHandler.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import { GitIntegrateModel } from './GitIntegrateModel.mjs'
import { createProvider } from './providers/ProviderFactory.mjs'

const execFileAsync = promisify(execFile)

function _isTextPath(rawPath) {
    const ext = rawPath.split('.').pop()?.toLowerCase() ?? ''
    return TEXT_EXTENSIONS.has(ext)
}

function _normalizeOverleafPath(rawPath) {
    return rawPath.startsWith('/') ? rawPath : `/${rawPath}`
}

function _normalizeRepoPath(rawPath) {
    return rawPath.startsWith('/') ? rawPath.slice(1) : rawPath
}

function _areBuffersEqual(a, b) {
    if (a === b) return true
    if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false
    return a.length === b.length && a.equals(b)
}

async function _writeTempTextFile(contents, suffix) {
    const path = join(tmpdir(), `git-integrate-merge-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`)
    await writeFile(path, contents, 'utf8')
    return path
}

async function _threeWayMergeText(base, local, remote) {
    const basePath = await _writeTempTextFile(base, 'base')
    const localPath = await _writeTempTextFile(local, 'local')
    const remotePath = await _writeTempTextFile(remote, 'remote')
    try {
        const result = await execFileAsync('git', ['merge-file', '-p', localPath, basePath, remotePath], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
        return { merged: result.stdout, conflicted: false }
    } catch (err) {
        if (err.code === 1 && typeof err.stdout === 'string') {
            return { merged: err.stdout, conflicted: true }
        }
        throw err
    } finally {
        await Promise.all([
            unlink(basePath).catch(() => { }),
            unlink(localPath).catch(() => { }),
            unlink(remotePath).catch(() => { }),
        ])
    }
}

// Maximum binary file size to push (10 MiB).  Larger files are skipped with a
// warning to avoid exceeding Git hosting API payload limits.
const MAX_BINARY_FILE_BYTES = 10 * 1024 * 1024

// File extensions treated as text documents inside Overleaf.
// Everything else is treated as a binary file and written via FileStore.
const TEXT_EXTENSIONS = new Set([
    'tex', 'bib', 'bst', 'cls', 'sty', 'clo', 'def', 'cfg',
    'txt', 'md', 'markdown', 'rst',
    'lua', 'py', 'r', 'R', 'js', 'ts', 'json', 'yaml', 'yml',
    'csv', 'tsv', 'xml', 'html', 'css',
    'tikz', 'pgf', 'gnuplot',
])

async function _streamToBuffer(stream) {
    const chunks = []
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
}

export const GitIntegrateHandler = {

    /**
     * Returns the (redacted) connection metadata for a project, or null.
     */
    async getConnection(projectId) {
        return GitIntegrateModel.getConnectionStatus(projectId)
    },

    /**
     * Validates the supplied credentials against the external Git API and, if
     * successful, persists the connection settings.
     */
    async saveConnection(projectId, { provider, baseUrl, repoId, branch, token }) {
        const gitProvider = createProvider(provider)
        const opts = baseUrl ? { baseUrl } : {}

        const ok = await gitProvider.testConnection(token, opts)
        if (!ok) {
            throw new Error(`Could not authenticate with ${provider}. Please check the token.`)
        }

        await GitIntegrateModel.saveConnection(projectId, {
            provider,
            baseUrl: baseUrl || null,
            repoId,
            branch,
            token,
        })

        // Seed lastSyncSha with the current remote HEAD so the first pull uses
        // it as the merge base rather than treating empty string as the ancestor.
        // Silently skip if the repo is empty or the branch doesn't exist yet.
        try {
            const headSha = await gitProvider.getCurrentCommitSha(
                token,
                repoId,
                branch || 'main',
                opts
            )
            if (headSha) {
                await GitIntegrateModel.updateLastSyncSha(projectId, headSha)
            }
        } catch (_err) {
            // New / empty repository — lastSyncSha stays null, which is fine.
        }
    },

    async deleteConnection(projectId) {
        await GitIntegrateModel.deleteConnection(projectId)
    },

    // ── Repository / branch listing (pre-connection setup) ──────────────────

    /**
     * Lists repositories accessible by the supplied token.
     * The token is used directly here (not persisted yet) so users can browse
     * repos during the setup wizard before committing to a connection.
     */
    async listRepositories(provider, token, baseUrl) {
        const gitProvider = createProvider(provider)
        const opts = baseUrl ? { baseUrl } : {}
        return gitProvider.listRepositories(token, opts)
    },

    async listBranches(provider, token, repoId, baseUrl) {
        const gitProvider = createProvider(provider)
        const opts = baseUrl ? { baseUrl } : {}
        return gitProvider.listBranches(token, repoId, opts)
    },
    async createRepository(provider, token, name, isPrivate, baseUrl) {
        const gitProvider = createProvider(provider)
        const opts = baseUrl ? { baseUrl } : {}
        return gitProvider.createRepository(token, name, isPrivate, opts)
    },
    // ── Push ────────────────────────────────────────────────────────────────

    /**
     * Exports all project docs and files as a single commit to the connected
     * external Git repository.
     *
     * @param {string} projectId
     * @param {string} commitMessage
     */
    async pushProject(projectId, commitMessage) {
        const connection = await GitIntegrateModel.getConnection(projectId)
        if (!connection) {
            throw new Error('Project is not connected to an external Git repository.')
        }

        const project = await ProjectGetter.promises.getProject(projectId, { name: 1 })
        if (!project) throw new Error('Project not found.')

        logger.info({ projectId }, 'git-integrate: starting push')

        // Collect all text documents
        const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
        // Collect all binary file references
        const files = await ProjectEntityHandler.promises.getAllFiles(projectId)

        /** @type {Array<{ path: string, content: string|Buffer }>} */
        const filesToCommit = []

        // Text documents — join lines with newline (same convention as zip export)
        for (const [rawPath, doc] of Object.entries(docs)) {
            const filePath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath
            filesToCommit.push({ path: filePath, content: (doc.lines || []).join('\n') })
        }

        // Binary files — stream from the history blob store
        const fileEntries = Object.entries(files)
        for (const [rawPath, file] of fileEntries) {
            if (!file.hash) {
                logger.warn({ projectId, path: rawPath }, 'git-integrate: binary file has no hash, skipping')
                continue
            }

            let buf
            try {
                const { stream } = await HistoryManager.promises.requestBlobWithProjectId(
                    projectId,
                    file.hash
                )
                buf = await _streamToBuffer(stream)
            } catch (err) {
                logger.warn({ err, projectId, path: rawPath }, 'git-integrate: could not fetch binary file blob, skipping')
                continue
            }

            if (buf.length > MAX_BINARY_FILE_BYTES) {
                logger.warn(
                    { projectId, path: rawPath, size: buf.length },
                    'git-integrate: skipping binary file that exceeds size limit'
                )
                continue
            }

            const filePath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath
            filesToCommit.push({ path: filePath, content: buf })
        }

        if (filesToCommit.length === 0) {
            throw new Error('No files found in the project to push.')
        }

        const gitProvider = createProvider(connection.provider)
        const opts = connection.baseUrl ? { baseUrl: connection.baseUrl } : {}

        // ── Conflict detection ────────────────────────────────────────────────
        // Fetch the current remote HEAD SHA and compare it with the SHA we had
        // after our last successful push or pull.  A mismatch means a
        // collaborator has pushed to the remote branch since we last synced;
        // we cannot safely fast-forward, so we push OL content to a new branch
        // instead (following the upstream Overleaf conflict-resolution flow).
        let currentRemoteSha = null
        try {
            currentRemoteSha = await gitProvider.getCurrentCommitSha(
                connection.token, connection.repoId, connection.branch, opts
            )
        } catch (err) {
            logger.warn(
                { err, projectId },
                'git-integrate: could not fetch current remote SHA, skipping conflict detection'
            )
        }

        const message = commitMessage || `Overleaf export: ${new Date().toISOString()}`

        if (
            connection.lastSyncSha &&
            currentRemoteSha &&
            currentRemoteSha !== connection.lastSyncSha
        ) {
            // Remote has diverged — push OL content to a conflict branch.
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            const conflictBranch = `overleaf/${ts}`
            logger.info(
                { projectId, conflictBranch, currentRemoteSha, lastSyncSha: connection.lastSyncSha },
                'git-integrate: remote has diverged, pushing to conflict branch'
            )
            await gitProvider.pushFilesToNewBranch(
                connection.token,
                connection.repoId,
                connection.branch,
                conflictBranch,
                message,
                filesToCommit,
                opts
            )
            logger.info(
                { projectId, conflictBranch, fileCount: filesToCommit.length },
                'git-integrate: conflict branch push completed'
            )
            return { conflictBranch }
        }

        // Normal push.
        const { sha: newSha } = await gitProvider.pushFiles(
            connection.token,
            connection.repoId,
            connection.branch,
            message,
            filesToCommit,
            opts
        )

        if (newSha) {
            await GitIntegrateModel.updateLastSyncSha(projectId, newSha)
        }

        logger.info(
            { projectId, fileCount: filesToCommit.length },
            'git-integrate: push completed'
        )
        return {}
    },

    // ── Pull ────────────────────────────────────────────────────────────────

    /**
     * Downloads all files from the connected Git repository and merges them
     * into the current Overleaf project.
     *
     * When there is a previous sync SHA available, this performs a 3-way merge
     * between the last synced commit, the current Overleaf content, and the
     * new remote branch contents.
     *
     * Text files (recognised by extension) are written as Overleaf docs so
     * they become editable in the editor.  All other files are written via
     * FileStore as binary file references.
     *
     * @param {string} projectId
     * @param {string} userId   Session user ID (required by Overleaf internals)
     */
    async pullProject(projectId, userId) {
        const connection = await GitIntegrateModel.getConnection(projectId)
        if (!connection) {
            throw new Error('Project is not connected to an external Git repository.')
        }

        const project = await ProjectGetter.promises.getProject(projectId, { name: 1 })
        if (!project) throw new Error('Project not found.')

        logger.info({ projectId }, 'git-integrate: starting pull')

        const gitProvider = createProvider(connection.provider)
        const opts = connection.baseUrl ? { baseUrl: connection.baseUrl } : {}

        const [remoteFiles, baseFiles] = await Promise.all([
            gitProvider.pullFiles(
                connection.token,
                connection.repoId,
                connection.branch,
                opts
            ),
            connection.lastSyncSha
                ? gitProvider.pullFilesAtRef(
                    connection.token,
                    connection.repoId,
                    connection.lastSyncSha,
                    opts
                )
                : Promise.resolve([]),
        ])

        const localDocs = await ProjectEntityHandler.promises.getAllDocs(projectId)
        const localFilesInfo = await ProjectEntityHandler.promises.getAllFiles(projectId)
        const localFiles = new Map()

        for (const [rawPath, doc] of Object.entries(localDocs)) {
            const filePath = _normalizeOverleafPath(rawPath)
            localFiles.set(filePath, {
                type: 'doc',
                content: (doc.lines || []).join('\n'),
            })
        }

        for (const [rawPath, file] of Object.entries(localFilesInfo)) {
            if (!file.hash) {
                logger.warn({ projectId, path: rawPath }, 'git-integrate: local binary file has no hash, skipping')
                continue
            }
            let buf
            try {
                const { stream } = await HistoryManager.promises.requestBlobWithProjectId(
                    projectId,
                    file.hash
                )
                buf = await _streamToBuffer(stream)
            } catch (err) {
                logger.warn({ err, projectId, path: rawPath }, 'git-integrate: could not fetch local binary file blob, skipping')
                continue
            }
            const filePath = _normalizeOverleafPath(rawPath)
            localFiles.set(filePath, { type: 'file', content: buf })
        }

        const baseFilesMap = new Map()
        for (const { path: rawPath, content } of baseFiles) {
            const filePath = _normalizeOverleafPath(rawPath)
            const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
            if (TEXT_EXTENSIONS.has(ext)) {
                baseFilesMap.set(filePath, {
                    type: 'doc',
                    content: Buffer.isBuffer(content) ? content.toString('utf8') : content,
                })
            } else {
                baseFilesMap.set(filePath, {
                    type: 'file',
                    content: Buffer.isBuffer(content) ? content : Buffer.from(content),
                })
            }
        }

        const remoteFilesMap = new Map()
        for (const { path: rawPath, content } of remoteFiles) {
            const filePath = _normalizeOverleafPath(rawPath)
            const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
            if (TEXT_EXTENSIONS.has(ext)) {
                remoteFilesMap.set(filePath, {
                    type: 'doc',
                    content: Buffer.isBuffer(content) ? content.toString('utf8') : content,
                })
            } else {
                remoteFilesMap.set(filePath, {
                    type: 'file',
                    content: Buffer.isBuffer(content) ? content : Buffer.from(content),
                })
            }
        }

        const allPaths = new Set([
            ...localFiles.keys(),
            ...remoteFilesMap.keys(),
            ...baseFilesMap.keys(),
        ])

        let textCount = 0
        let binaryCount = 0
        const conflicts = []
        const plannedOps = []

        function _contentsEqual(a, b) {
            if (a == null || b == null) return a === b
            if (typeof a === 'string' || typeof b === 'string') {
                return String(a) === String(b)
            }
            return _areBuffersEqual(a, b)
        }

        for (const filePath of allPaths) {
            const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
            const isText = _isTextPath(filePath)

            const baseEntry = baseFilesMap.get(filePath) || null
            const localEntry = localFiles.get(filePath) || null
            const remoteEntry = remoteFilesMap.get(filePath) || null

            const baseContent = baseEntry?.content ?? null
            const localContent = localEntry?.content ?? null
            const remoteContent = remoteEntry?.content ?? null

            const baseExists = baseEntry !== null
            const localExists = localEntry !== null
            const remoteExists = remoteEntry !== null

            const localSameAsBase = baseExists && localExists && _contentsEqual(localContent, baseContent)
            const remoteSameAsBase = baseExists && remoteExists && _contentsEqual(remoteContent, baseContent)

            const planRemote = () => {
                if (isText) {
                    plannedOps.push({
                        type: 'doc',
                        path: filePath,
                        content: String(remoteContent),
                    })
                } else {
                    plannedOps.push({
                        type: 'file',
                        path: filePath,
                        content: Buffer.isBuffer(remoteContent) ? remoteContent : Buffer.from(remoteContent),
                    })
                }
            }

            const planDelete = () => {
                plannedOps.push({
                    type: 'delete',
                    path: filePath,
                })
            }

            const planTextMerge = async (baseText, localText, remoteText) => {
                const { merged, conflicted } = await _threeWayMergeText(baseText, localText, remoteText)
                if (conflicted) {
                    conflicts.push(filePath)
                    return
                }
                plannedOps.push({ type: 'doc', path: filePath, content: merged })
            }

            if (!baseExists) {
                if (!localExists && remoteExists) {
                    planRemote()
                } else if (localExists && !remoteExists) {
                    // Keep local-only file.
                } else if (localExists && remoteExists) {
                    if (_contentsEqual(localContent, remoteContent)) {
                        // same content; keep local
                    } else if (isText) {
                        await planTextMerge('', String(localContent), String(remoteContent))
                    } else {
                        conflicts.push(filePath)
                    }
                }
            } else {
                if (localSameAsBase && remoteSameAsBase) {
                    // no change
                } else if (localSameAsBase && !remoteSameAsBase) {
                    if (remoteExists) {
                        planRemote()
                    } else {
                        planDelete()
                    }
                } else if (!localSameAsBase && remoteSameAsBase) {
                    // keep local changes
                } else {
                    if (!localExists && !remoteExists) {
                        planDelete()
                    } else if (!localExists && remoteExists) {
                        conflicts.push(filePath)
                    } else if (localExists && !remoteExists) {
                        conflicts.push(filePath)
                    } else {
                        if (_contentsEqual(localContent, remoteContent)) {
                            // both changed but same update
                        } else if (isText) {
                            await planTextMerge(
                                String(baseContent),
                                String(localContent),
                                String(remoteContent)
                            )
                        } else {
                            conflicts.push(filePath)
                        }
                    }
                }
            }
        }

        if (conflicts.length > 0) {
            const err = new Error(
                `Merge conflict detected on the following file(s): ${conflicts.join(', ')}. Please resolve the conflict in Git before pulling again.`
            )
            err.conflictedPaths = conflicts
            throw err
        }

        const tmpFiles = []
        try {
            for (const op of plannedOps) {
                if (op.type === 'delete') {
                    await EditorController.promises.deleteEntityWithPath(
                        projectId,
                        op.path,
                        'git-bridge',
                        userId
                    )
                    continue
                }

                if (op.type === 'doc') {
                    const lines = String(op.content).split(/\r?\n/)
                    await EditorController.promises.upsertDocWithPath(
                        projectId,
                        op.path,
                        lines,
                        'git-bridge',
                        userId
                    )
                    textCount++
                    continue
                }

                if (op.type === 'file') {
                    if (op.content.length > MAX_BINARY_FILE_BYTES) {
                        logger.warn(
                            { projectId, path: op.path, size: op.content.length },
                            'git-integrate: skipping binary file that exceeds size limit'
                        )
                        continue
                    }
                    const tmpPath = join(tmpdir(), `git-integrate-pull-${Date.now()}-${Math.random().toString(36).slice(2)}`)
                    await writeFile(tmpPath, op.content)
                    tmpFiles.push(tmpPath)
                    await EditorController.promises.upsertFileWithPath(
                        projectId,
                        op.path,
                        tmpPath,
                        null,
                        'git-bridge',
                        userId
                    )
                    binaryCount++
                }
            }
        } finally {
            for (const tmpPath of tmpFiles) {
                unlink(tmpPath).catch(() => { })
            }
        }

        logger.info(
            { projectId, textCount, binaryCount },
            'git-integrate: pull completed'
        )

        // Update the stored SHA so that subsequent push calls can detect
        // whether the remote branch has moved since this pull.
        try {
            const pullProvider = createProvider(connection.provider)
            const pullOpts = connection.baseUrl ? { baseUrl: connection.baseUrl } : {}
            const sha = await pullProvider.getCurrentCommitSha(
                connection.token, connection.repoId, connection.branch, pullOpts
            )
            if (sha) await GitIntegrateModel.updateLastSyncSha(projectId, sha)
        } catch (err) {
            logger.warn(
                { err, projectId },
                'git-integrate: could not update lastSyncSha after pull'
            )
        }

        return { textCount, binaryCount }
    },
}
