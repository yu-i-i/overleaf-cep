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
import logger from '@overleaf/logger'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectEntityUpdateHandler from '../../../../app/src/Features/Project/ProjectEntityUpdateHandler.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import { GitIntegrateModel } from './GitIntegrateModel.mjs'
import { createProvider } from './providers/ProviderFactory.mjs'

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

        await gitProvider.pushFiles(
            connection.token,
            connection.repoId,
            connection.branch,
            commitMessage || `Overleaf export: ${new Date().toISOString()}`,
            filesToCommit,
            opts
        )

        logger.info(
            { projectId, fileCount: filesToCommit.length },
            'git-integrate: push completed'
        )
    },

    // ── Pull ────────────────────────────────────────────────────────────────

    /**
     * Downloads all files from the connected Git repository into the Overleaf
     * project, overwriting existing content.
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

        const remoteFiles = await gitProvider.pullFiles(
            connection.token,
            connection.repoId,
            connection.branch,
            opts
        )

        const source = 'git-integrate'
        let textCount = 0
        let binaryCount = 0
        const tmpFiles = []

        try {
            for (const { path: rawPath, content } of remoteFiles) {
                // Normalise: ensure leading slash for Overleaf path convention
                const docPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
                const ext = rawPath.split('.').pop()?.toLowerCase() ?? ''

                if (TEXT_EXTENSIONS.has(ext)) {
                    // Write as editable Overleaf document
                    const text = Buffer.isBuffer(content)
                        ? content.toString('utf8')
                        : content
                    const lines = text.split(/\r?\n/)
                    await ProjectEntityUpdateHandler.promises.upsertDocWithPath(
                        projectId, docPath, lines, source, userId
                    )
                    textCount++
                } else {
                    // Write as binary file via temp file + FileStore
                    if (Buffer.isBuffer(content) && content.length > MAX_BINARY_FILE_BYTES) {
                        logger.warn(
                            { projectId, path: rawPath, size: content.length },
                            'git-integrate: skipping binary file that exceeds size limit'
                        )
                        continue
                    }
                    const tmpPath = join(tmpdir(), `git-integrate-pull-${Date.now()}-${Math.random().toString(36).slice(2)}`)
                    await writeFile(tmpPath, content)
                    tmpFiles.push(tmpPath)
                    await ProjectEntityUpdateHandler.promises.upsertFileWithPath(
                        projectId, docPath, tmpPath, null, userId, source
                    )
                    binaryCount++
                }
            }
        } finally {
            // Clean up temp files
            for (const tmpPath of tmpFiles) {
                unlink(tmpPath).catch(() => { })
            }
        }

        logger.info(
            { projectId, textCount, binaryCount },
            'git-integrate: pull completed'
        )
        return { textCount, binaryCount }
    },
}
