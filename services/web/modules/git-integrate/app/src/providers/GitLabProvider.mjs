/**
 * GitLab REST API provider for git-integrate.
 *
 * Adapted from TeXlyre's extras/backup/gitlab/GitLabAPIService.ts
 * (see texlyre/extras/backup/gitlab/GitLabAPIService.ts in this repository,
 *  MIT Licence, Copyright (c) TeXlyre contributors).
 *
 * Key differences from the browser-side TeXlyre implementation:
 *  - Runs in Node.js 22; uses Buffer instead of btoa.
 *  - Uses GitLab's batch-commit actions endpoint so all project files land in
 *    a single git commit (`POST /projects/:id/repository/commits`).
 *  - Works with both gitlab.com and self-hosted GitLab instances.
 */

const DEFAULT_BASE_URL = 'https://gitlab.com/api/v4'
const REQUEST_TIMEOUT_MS = 30_000

function _encodeContent(content) {
    if (Buffer.isBuffer(content)) return content.toString('base64')
    return Buffer.from(content, 'utf8').toString('base64')
}

async function _request(token, baseUrl, endpoint, options = {}) {
    const url = `${baseUrl}/${endpoint}`
    const headers = {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
        ...options.headers,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            signal: controller.signal,
        })
        clearTimeout(timer)
        if (!response.ok) {
            const err = await response.json().catch(() => ({}))
            const body = err.message || err.error || ''
            let msg
            if (response.status === 401) {
                msg = `GitLab authentication failed on '${endpoint}': the token has been revoked or is invalid.`
            } else if (response.status === 403) {
                msg = `GitLab permission denied on '${endpoint}': the token lacks required scopes (needs read_repository and write_repository, or api).`
            } else if (response.status === 404) {
                msg = `GitLab resource not found on '${endpoint}': check that the repository and branch still exist and the token has access.`
            } else {
                msg = `GitLab API error on '${endpoint}': ${response.status} ${response.statusText}. ${body}`
            }
            throw new Error(msg)
        }
        if (response.status === 204) return null
        return response.json()
    } catch (err) {
        clearTimeout(timer)
        if (err.name === 'AbortError') {
            throw new Error(`GitLab API request timeout after ${REQUEST_TIMEOUT_MS / 1000}s`)
        }
        throw err
    }
}

export class GitLabProvider {
    async testConnection(token, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
            const res = await fetch(`${baseUrl}/user`, {
                headers: { 'PRIVATE-TOKEN': token },
                signal: controller.signal,
            })
            clearTimeout(timer)
            return res.ok
        } catch {
            return false
        }
    }

    /**
     * @returns {Promise<Array<{ id: string, name: string, fullName: string, private: boolean, defaultBranch: string }>>}
     */
    async listRepositories(token, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const projects = await _request(
            token, baseUrl,
            'projects?membership=true&per_page=100&order_by=last_activity_at'
        )
        return projects.map(p => ({
            id: p.path_with_namespace,
            name: p.name,
            fullName: p.path_with_namespace,
            private: p.visibility === 'private',
            defaultBranch: p.default_branch || 'main',
        }))
    }

    async listBranches(token, repoId, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const encodedId = encodeURIComponent(repoId)
        const branches = await _request(
            token, baseUrl,
            `projects/${encodedId}/repository/branches`
        )
        return branches.map(b => ({ name: b.name, protected: b.protected }))
    }

    /**
     * Creates a new project (repository) for the authenticated user.
     */
    async createRepository(token, name, isPrivate, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const project = await _request(token, baseUrl, 'projects', {
            method: 'POST',
            body: JSON.stringify({
                name,
                visibility: isPrivate ? 'private' : 'public',
                initialize_with_readme: true,
            }),
        })
        return {
            id: project.path_with_namespace,
            name: project.name,
            fullName: project.path_with_namespace,
            private: project.visibility === 'private',
            defaultBranch: project.default_branch || 'main',
        }
    }

    /**
     * Returns the current HEAD commit SHA of a branch.
     */
    async getCurrentCommitSha(token, repoId, branch, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const encodedId = encodeURIComponent(repoId)
        const data = await _request(
            token, baseUrl,
            `projects/${encodedId}/repository/branches/${encodeURIComponent(branch)}`
        )
        return data.commit.id
    }

    /**
     * Fetches every blob path in the repository tree (paginated).
     * Returns a Set of file paths that already exist on the given branch.
     */
    async _getExistingPaths(token, baseUrl, repoId, branch) {
        const encodedId = encodeURIComponent(repoId)
        const existingPaths = new Set()
        let page = 1
        try {
            while (true) {
                const items = await _request(
                    token, baseUrl,
                    `projects/${encodedId}/repository/tree?recursive=true&ref=${encodeURIComponent(branch)}&per_page=100&page=${page}`
                )
                if (!Array.isArray(items) || items.length === 0) break
                for (const item of items) {
                    if (item.type === 'blob') existingPaths.add(item.path)
                }
                if (items.length < 100) break
                page++
            }
        } catch {
            // Repository might be empty / branch might not exist — treat as empty.
        }
        return existingPaths
    }

    /**
     * Fetches all files from the repository at the given branch.
     * Returns Array<{ path: string, content: Buffer }>.
     */
    async pullFiles(token, repoId, branch, opts = {}) {
        return this.pullFilesAtRef(token, repoId, branch, opts)
    }

    async pullFilesAtRef(token, repoId, ref, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const encodedId = encodeURIComponent(repoId)

        // Collect all blob paths via paginated tree listing.
        const paths = []
        let page = 1
        while (true) {
            const items = await _request(
                token, baseUrl,
                `projects/${encodedId}/repository/tree?recursive=true&ref=${encodeURIComponent(ref)}&per_page=100&page=${page}`
            )
            if (!Array.isArray(items) || items.length === 0) break
            for (const item of items) {
                if (item.type === 'blob') paths.push(item.path)
            }
            if (items.length < 100) break
            page++
        }

        // Fetch each file's content (base64) in parallel batches of 5.
        const CONCURRENCY = 5
        const result = []
        for (let i = 0; i < paths.length; i += CONCURRENCY) {
            const batch = paths.slice(i, i + CONCURRENCY)
            const fetched = await Promise.all(batch.map(async p => {
                const encodedPath = p.split('/').map(encodeURIComponent).join('/')
                const data = await _request(
                    token, baseUrl,
                    `projects/${encodedId}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`
                )
                return { path: data.file_path, content: Buffer.from(data.content, 'base64') }
            }))
            result.push(...fetched)
        }
        return result
    }

    /**
     * Pushes all files in a single batch commit using GitLab's commit actions API.
     */
    async pushFiles(token, repoId, branch, commitMessage, files, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const encodedId = encodeURIComponent(repoId)

        const existingPaths = await this._getExistingPaths(token, baseUrl, repoId, branch)

        const actions = files.map(f => {
            const cleanPath = f.path.replace(/^\/+/, '').replace(/\/+/g, '/')
            const action = existingPaths.has(cleanPath) ? 'update' : 'create'
            return {
                action,
                file_path: cleanPath,
                content: _encodeContent(f.content),
                encoding: 'base64',
            }
        })

        if (actions.length === 0) return { sha: null }

        const result = await _request(token, baseUrl, `projects/${encodedId}/repository/commits`, {
            method: 'POST',
            body: JSON.stringify({ branch, commit_message: commitMessage, actions }),
        })
        return { sha: result.id }
    }

    /**
     * Pushes all OL files to a *new* branch, created from the current HEAD of
     * `baseBranch`.  Uses GitLab's `start_branch` parameter to create the new
     * branch and commit in a single API call.
     *
     * @param {string} token
     * @param {string} repoId
     * @param {string} baseBranch
     * @param {string} newBranchName
     * @param {string} commitMessage
     * @param {Array<{ path: string, content: string|Buffer }>} files
     * @param {{ baseUrl?: string }} opts
     * @returns {Promise<{ sha: string }>}
     */
    async pushFilesToNewBranch(token, repoId, baseBranch, newBranchName, commitMessage, files, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const encodedId = encodeURIComponent(repoId)

        // Determine which paths exist on baseBranch so we can choose
        // 'create' vs 'update' actions correctly on the new branch.
        const existingPaths = await this._getExistingPaths(token, baseUrl, repoId, baseBranch)

        const actions = files.map(f => {
            const cleanPath = f.path.replace(/^\/+/, '').replace(/\/+/g, '/')
            const action = existingPaths.has(cleanPath) ? 'update' : 'create'
            return {
                action,
                file_path: cleanPath,
                content: _encodeContent(f.content),
                encoding: 'base64',
            }
        })

        if (actions.length === 0) return { sha: null }

        const result = await _request(token, baseUrl, `projects/${encodedId}/repository/commits`, {
            method: 'POST',
            body: JSON.stringify({
                branch: newBranchName,
                start_branch: baseBranch,
                commit_message: commitMessage,
                actions,
            }),
        })
        return { sha: result.id }
    }
}
