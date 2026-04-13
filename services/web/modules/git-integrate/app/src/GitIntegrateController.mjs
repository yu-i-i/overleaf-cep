/**
 * HTTP controller for git-integrate.
 *
 * All handlers follow the existing Overleaf controller convention:
 * – Validate inputs at the boundary.
 * – Delegate business logic to GitIntegrateHandler.
 * – Return JSON responses.
 */

import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { GitIntegrateHandler } from './GitIntegrateHandler.mjs'
import { SUPPORTED_PROVIDERS } from './providers/ProviderFactory.mjs'

// ── Helpers ──────────────────────────────────────────────────────────────────

function _userId(req) {
    return SessionManager.getLoggedInUserId(req.session)
}

function _sendError(res, status, message, err) {
    if (err) logger.warn({ err }, `git-integrate: ${message}`)
    res.status(status).json({ error: message })
}

// ── GET /git-integrate/project/:project_id ─────────────────────────────────

function _getProjectId(req) {
    return req.params.projectId || req.params.project_id
}

export async function getConnection(req, res) {
    const projectId = _getProjectId(req)
    try {
        const connection = await GitIntegrateHandler.getConnection(projectId)
        res.json({ connection: connection || null })
    } catch (err) {
        _sendError(res, 500, 'Failed to retrieve connection status', err)
    }
}

// ── POST /git-integrate/project/:project_id/connect ────────────────────────

export async function connect(req, res) {
    const projectId = _getProjectId(req)
    const { provider, baseUrl, repoId, branch, token } = req.body || {}

    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return _sendError(res, 400, `Unsupported provider '${provider}'`)
    }
    if (!repoId || typeof repoId !== 'string') {
        return _sendError(res, 400, 'repoId is required')
    }
    if (!token || typeof token !== 'string' || !token.trim()) {
        return _sendError(res, 400, 'token is required')
    }

    try {
        await GitIntegrateHandler.saveConnection(projectId, {
            provider,
            baseUrl: baseUrl || null,
            repoId: repoId.trim(),
            branch: (branch || 'main').trim(),
            token: token.trim(),
        })
        res.json({ success: true })
    } catch (err) {
        _sendError(res, 400, err.message || 'Failed to connect', err)
    }
}

// ── DELETE /git-integrate/project/:projectId ──────────────────────────────

export async function disconnect(req, res) {
    const projectId = _getProjectId(req)
    try {
        await GitIntegrateHandler.deleteConnection(projectId)
        res.json({ success: true })
    } catch (err) {
        _sendError(res, 500, 'Failed to disconnect', err)
    }
}

// ── POST /git-integrate/project/:project_id/push ───────────────────────────

export async function push(req, res) {
    const projectId = _getProjectId(req)
    const { commitMessage } = req.body || {}
    try {
        await GitIntegrateHandler.pushProject(
            projectId,
            typeof commitMessage === 'string' ? commitMessage.trim() : undefined
        )
        res.json({ success: true })
    } catch (err) {
        _sendError(res, 400, err.message || 'Push failed', err)
    }
}

// ── POST /git-integrate/project/:project_id/pull ───────────────────────────

export async function pull(req, res) {
    const projectId = _getProjectId(req)
    const userId = _userId(req)
    try {
        const { textCount, binaryCount } = await GitIntegrateHandler.pullProject(projectId, userId)
        res.json({ success: true, textCount, binaryCount })
    } catch (err) {
        _sendError(res, 400, err.message || 'Pull failed', err)
    }
}

// ── POST /git-integrate/repos ─────────────────────────────────────────────
// Lists repos for a given token during the setup wizard (token NOT persisted).

export async function listRepositories(req, res) {
    const { provider, token, baseUrl } = req.body || {}
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return _sendError(res, 400, `Unsupported provider '${provider}'`)
    }
    if (!token || typeof token !== 'string' || !token.trim()) {
        return _sendError(res, 400, 'token is required')
    }

    try {
        const repos = await GitIntegrateHandler.listRepositories(
            provider,
            token.trim(),
            baseUrl || null
        )
        res.json({ repos })
    } catch (err) {
        _sendError(res, 400, err.message || 'Failed to list repositories', err)
    }
}

// ── POST /git-integrate/branches ─────────────────────────────────────────
// Lists branches for a given repo during setup (token NOT persisted).

export async function listBranches(req, res) {
    const { provider, token, repoId, baseUrl } = req.body || {}
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return _sendError(res, 400, `Unsupported provider '${provider}'`)
    }
    if (!token || typeof token !== 'string' || !token.trim()) {
        return _sendError(res, 400, 'token is required')
    }
    if (!repoId || typeof repoId !== 'string') {
        return _sendError(res, 400, 'repoId is required')
    }

    try {
        const branches = await GitIntegrateHandler.listBranches(
            provider,
            token.trim(),
            repoId.trim(),
            baseUrl || null
        )
        res.json({ branches })
    } catch (err) {
        _sendError(res, 400, err.message || 'Failed to list branches', err)
    }
}

// ── POST /git-integrate/repos/create ───────────────────────────────────────────────
// Creates a new repository on the remote host (token NOT persisted).

export async function createRepository(req, res) {
    const { provider, token, name, baseUrl } = req.body || {}
    const isPrivate = req.body?.private !== false // default to private
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return _sendError(res, 400, `Unsupported provider '${provider}'`)
    }
    if (!token || typeof token !== 'string' || !token.trim()) {
        return _sendError(res, 400, 'token is required')
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
        return _sendError(res, 400, 'name is required')
    }

    try {
        const repo = await GitIntegrateHandler.createRepository(
            provider,
            token.trim(),
            name.trim(),
            !!isPrivate,
            baseUrl || null
        )
        res.json({ repo })
    } catch (err) {
        _sendError(res, 400, err.message || 'Failed to create repository', err)
    }
}
