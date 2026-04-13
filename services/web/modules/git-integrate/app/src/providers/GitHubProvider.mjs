/**
 * GitHub REST API provider for git-integrate.
 *
 * Adapted from TeXlyre's extras/backup/github/GitHubAPIService.ts
 * (see texlyre/extras/backup/github/GitHubAPIService.ts in this repository,
 *  MIT Licence, Copyright (c) TeXlyre contributors).
 *
 * Key differences from the browser-side TeXlyre implementation:
 *  - Runs in Node.js 22; uses Buffer instead of btoa/atob.
 *  - Accepts Buffer and string content (no ArrayBuffer needed).
 *  - Uses the git-trees + git-commits API for atomic batch commits so that the
 *    entire project is pushed in one logical git commit regardless of file count.
 */

const DEFAULT_BASE_URL = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * @param {string} content  string or Buffer
 * @returns {string} base64-encoded content
 */
function _encodeContent(content) {
    if (Buffer.isBuffer(content)) return content.toString('base64')
    return Buffer.from(content, 'utf8').toString('base64')
}

/**
 * Low-level fetch wrapper that sets the Accept / Authorization headers and
 * translates non-2xx responses into thrown Errors.
 *
 * @param {string} token
 * @param {string} baseUrl
 * @param {string} endpoint  path relative to baseUrl (no leading slash)
 * @param {RequestInit} options
 */
async function _request(token, baseUrl, endpoint, options = {}) {
    const url = `${baseUrl}/${endpoint}`
    const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        ...options.headers,
    }
    if (options.body) headers['Content-Type'] = 'application/json'

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
            throw new Error(
                `GitHub API error on '${endpoint}': ${response.status} ${response.statusText}. ${err.message || ''}`
            )
        }
        if (response.status === 204) return null
        return response.json()
    } catch (err) {
        clearTimeout(timer)
        if (err.name === 'AbortError') {
            throw new Error(`GitHub API request timeout after ${REQUEST_TIMEOUT_MS / 1000}s`)
        }
        throw err
    }
}

export class GitHubProvider {
    /**
     * Returns true if the token can authenticate with the GitHub API.
     * @param {string} token
     * @param {{ baseUrl?: string }} opts
     */
    async testConnection(token, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
            const res = await fetch(`${baseUrl}/user`, {
                headers: { Authorization: `token ${token}` },
                signal: controller.signal,
            })
            clearTimeout(timer)
            return res.ok
        } catch {
            return false
        }
    }

    /**
     * @param {string} token
     * @param {{ baseUrl?: string }} opts
     * @returns {Promise<Array<{ id: string, name: string, fullName: string, private: boolean, defaultBranch: string }>>}
     */
    async listRepositories(token, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const repos = await _request(token, baseUrl, 'user/repos?per_page=100&sort=updated')
        return repos.map(r => ({
            id: r.full_name,
            name: r.name,
            fullName: r.full_name,
            private: r.private,
            defaultBranch: r.default_branch,
        }))
    }

    /**
     * @param {string} token
     * @param {string} repoId  "owner/repo"
     * @param {{ baseUrl?: string }} opts
     * @returns {Promise<Array<{ name: string, protected: boolean }>>}
     */
    async listBranches(token, repoId, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        return _request(token, baseUrl, `repos/${repoId}/branches`)
    }

    /**
     * Creates a new repository for the authenticated user.
     */
    async createRepository(token, name, isPrivate, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const repo = await _request(token, baseUrl, 'user/repos', {
            method: 'POST',
            body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
        })
        return {
            id: repo.full_name,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            defaultBranch: repo.default_branch || 'main',
        }
    }

    // ── Internal git tree helpers ────────────────────────────────────────────

    async _getLatestCommit(token, baseUrl, owner, repo, branch) {
        const data = await _request(token, baseUrl, `repos/${owner}/${repo}/branches/${branch}`)
        return {
            sha: data.commit.sha,
            treeSha: data.commit.commit.tree.sha,
        }
    }

    async _createBlob(token, baseUrl, owner, repo, content) {
        const data = await _request(token, baseUrl, `repos/${owner}/${repo}/git/blobs`, {
            method: 'POST',
            body: JSON.stringify({ content: _encodeContent(content), encoding: 'base64' }),
        })
        return data.sha
    }

    async _createTree(token, baseUrl, owner, repo, baseTreeSha, items) {
        const data = await _request(token, baseUrl, `repos/${owner}/${repo}/git/trees`, {
            method: 'POST',
            body: JSON.stringify({ base_tree: baseTreeSha, tree: items }),
        })
        return data.sha
    }

    async _createCommit(token, baseUrl, owner, repo, message, treeSha, parentSha) {
        const data = await _request(token, baseUrl, `repos/${owner}/${repo}/git/commits`, {
            method: 'POST',
            body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
        })
        return data.sha
    }

    async _updateRef(token, baseUrl, owner, repo, commitSha, branch) {
        await _request(token, baseUrl, `repos/${owner}/${repo}/git/refs/heads/${branch}`, {
            method: 'PATCH',
            body: JSON.stringify({ sha: commitSha }),
        })
    }

    /**
     * Fetches all files from the repository at the given branch.
     * Returns Array<{ path: string, content: Buffer }>.
     * Uses the git-trees API (single request) + parallel blob fetches.
     */
    async pullFiles(token, repoId, branch, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const [owner, repo] = repoId.split('/')

        // Get the full recursive tree in one call.
        const { sha: commitSha } = await this._getLatestCommit(token, baseUrl, owner, repo, branch)
        const treeData = await _request(
            token, baseUrl,
            `repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`
        )
        const blobs = (treeData.tree || []).filter(item => item.type === 'blob')

        // Fetch each blob content in parallel batches of 5.
        const CONCURRENCY = 5
        const result = []
        for (let i = 0; i < blobs.length; i += CONCURRENCY) {
            const batch = blobs.slice(i, i + CONCURRENCY)
            const fetched = await Promise.all(batch.map(async item => {
                const data = await _request(token, baseUrl, `repos/${owner}/${repo}/git/blobs/${item.sha}`)
                return { path: item.path, content: Buffer.from(data.content.replace(/\n/g, ''), 'base64') }
            }))
            result.push(...fetched)
        }
        return result
    }

    /**
     * Pushes all files in a single atomic git commit.
     *
     * @param {string} token
     * @param {string} repoId  "owner/repo"
     * @param {string} branch
     * @param {string} commitMessage
     * @param {Array<{ path: string, content: string|Buffer }>} files
     * @param {{ baseUrl?: string }} opts
     */
    async pushFiles(token, repoId, branch, commitMessage, files, opts = {}) {
        const baseUrl = opts.baseUrl || DEFAULT_BASE_URL
        const [owner, repo] = repoId.split('/')

        const { sha: parentSha, treeSha: baseTreeSha } =
            await this._getLatestCommit(token, baseUrl, owner, repo, branch)

        // Create a blob for every file (in parallel, capped to avoid rate limits)
        const CONCURRENCY = 5
        const treeItems = []
        for (let i = 0; i < files.length; i += CONCURRENCY) {
            const batch = files.slice(i, i + CONCURRENCY)
            const blobShas = await Promise.all(
                batch.map(f => this._createBlob(token, baseUrl, owner, repo, f.content))
            )
            for (let j = 0; j < batch.length; j++) {
                const cleanPath = batch[j].path.replace(/^\/+/, '').replace(/\/+/g, '/')
                if (!cleanPath) continue
                treeItems.push({
                    path: cleanPath,
                    mode: '100644',
                    type: 'blob',
                    sha: blobShas[j],
                })
            }
        }

        if (treeItems.length === 0) return

        const newTreeSha = await this._createTree(
            token, baseUrl, owner, repo, baseTreeSha, treeItems
        )
        const newCommitSha = await this._createCommit(
            token, baseUrl, owner, repo, commitMessage, newTreeSha, parentSha
        )
        await this._updateRef(token, baseUrl, owner, repo, newCommitSha, branch)
    }
}
