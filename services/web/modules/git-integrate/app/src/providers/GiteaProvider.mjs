/**
 * Gitea / Forgejo REST API provider for git-integrate.
 *
 * Adapted from TeXlyre's extras/backup/gitea/GiteaAPIService.ts and
 * extras/backup/forgejo/ForgejoAPIService.ts
 * (see texlyre/extras/backup/gitea/ and texlyre/extras/backup/forgejo/ in
 *  this repository, MIT Licence, Copyright (c) TeXlyre contributors).
 *
 * Gitea and Forgejo share a compatible REST API; the only runtime difference
 * is the default base URL, which callers provide via `opts.baseUrl`.
 *
 * Pushs are done through the batch-file endpoint
 * `POST /repos/:owner/:repo/contents` which creates/updates multiple files in
 * one commit — an extension Gitea introduced in v1.15 and Forgejo supports too.
 *
 * Default base URLs (can be overridden by operators):
 *   Gitea:   https://gitea.com/api/v1
 *   Forgejo: https://codeberg.org/api/v1
 */

const DEFAULT_BASE_URL_GITEA = 'https://gitea.com/api/v1'
const DEFAULT_BASE_URL_FORGEJO = 'https://codeberg.org/api/v1'
const REQUEST_TIMEOUT_MS = 30_000

function _encodeContent(content) {
    if (Buffer.isBuffer(content)) return content.toString('base64')
    return Buffer.from(content, 'utf8').toString('base64')
}

async function _request(token, baseUrl, endpoint, options = {}) {
    const url = `${baseUrl}/${endpoint}`
    const headers = {
        Authorization: `token ${token}`,
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
            throw new Error(
                `Gitea/Forgejo API error on '${endpoint}': ${response.status} ${response.statusText}. ${err.message || ''}`
            )
        }
        if (response.status === 204) return null
        return response.json()
    } catch (err) {
        clearTimeout(timer)
        if (err.name === 'AbortError') {
            throw new Error(`Gitea/Forgejo API request timeout after ${REQUEST_TIMEOUT_MS / 1000}s`)
        }
        throw err
    }
}

export class GiteaProvider {
    /**
     * @param {'gitea'|'forgejo'} variant  Controls the default base URL shown
     *   in the UI, but the actual URL is always supplied via opts.baseUrl.
     */
    constructor(variant = 'gitea') {
        this._defaultBaseUrl =
            variant === 'forgejo' ? DEFAULT_BASE_URL_FORGEJO : DEFAULT_BASE_URL_GITEA
    }

    _baseUrl(opts) {
        return opts.baseUrl || this._defaultBaseUrl
    }

    async testConnection(token, opts = {}) {
        const baseUrl = this._baseUrl(opts)
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
     * @returns {Promise<Array<{ id: string, name: string, fullName: string, private: boolean, defaultBranch: string }>>}
     */
    async listRepositories(token, opts = {}) {
        const baseUrl = this._baseUrl(opts)
        // /user/repos returns only the authenticated user’s own repos.
        // repos/search shows ALL server repos for admin accounts, so we avoid it.
        const repos = await _request(token, baseUrl, 'user/repos?limit=50')
        const list = Array.isArray(repos) ? repos : (repos.data || [])
        return list.map(r => ({
            id: r.full_name,
            name: r.name,
            fullName: r.full_name,
            private: r.private,
            defaultBranch: r.default_branch || 'main',
        }))
    }

    async listBranches(token, repoId, opts = {}) {
        const baseUrl = this._baseUrl(opts)
        const [owner, repo] = repoId.split('/')
        const branches = await _request(
            token, baseUrl,
            `repos/${owner}/${repo}/branches`
        )
        const list = Array.isArray(branches) ? branches : []
        return list.map(b => ({ name: b.name, protected: b.protected }))
    }

    /**     * Creates a new repository owned by the authenticated user.
     */
    async createRepository(token, name, isPrivate, opts = {}) {
        const baseUrl = this._baseUrl(opts)
        const repo = await _request(token, baseUrl, 'user/repos', {
            method: 'POST',
            body: JSON.stringify({
                name,
                private: isPrivate,
                auto_init: true,
                default_branch: 'main',
            }),
        })
        return {
            id: repo.full_name,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            defaultBranch: repo.default_branch || 'main',
        }
    }

    /**     * Pushes all files using Gitea's batch-file contents endpoint.
     * Falls back to individual file updates if the batch endpoint is unavailable
     * (older Gitea instances).
     */
    async pushFiles(token, repoId, branch, commitMessage, files, opts = {}) {
        const baseUrl = this._baseUrl(opts)
        const [owner, repo] = repoId.split('/')

        const fileOps = files.map(f => ({
            operation: 'upsert',               // Gitea 1.21+ supports 'upsert'
            path: f.path.replace(/^\/+/, '').replace(/\/+/g, '/'),
            content: _encodeContent(f.content),
            encoding: 'base64',
        }))

        if (fileOps.length === 0) return

        // Attempt batch endpoint first.
        try {
            await _request(token, baseUrl, `repos/${owner}/${repo}/contents`, {
                method: 'POST',
                body: JSON.stringify({
                    branch,
                    message: commitMessage,
                    files: fileOps,
                }),
            })
        } catch (batchErr) {
            // Batch endpoint not available — fall back to sequential upsert.
            await this._pushFilesSequentially(
                token, baseUrl, owner, repo, branch, commitMessage, files
            )
        }
    }

    async _pushFilesSequentially(token, baseUrl, owner, repo, branch, commitMessage, files) {
        for (const f of files) {
            const cleanPath = f.path.replace(/^\/+/, '').replace(/\/+/g, '/')
            const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/')
            const body = {
                message: commitMessage,
                content: _encodeContent(f.content),
                branch,
            }

            // Try to fetch the existing file's SHA.  A 404 means new file.
            let method = 'POST'
            try {
                const existing = await _request(
                    token, baseUrl,
                    `repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
                )
                if (existing?.sha) {
                    body.sha = existing.sha
                    method = 'PUT'
                }
            } catch {
                // File does not exist yet — use POST to create it.
            }

            await _request(
                token, baseUrl,
                `repos/${owner}/${repo}/contents/${encodedPath}`,
                { method, body: JSON.stringify(body) }
            )
        }
    }

    /**
     * Fetches all files from the repository at the given branch.
     * Returns Array<{ path: string, content: Buffer }>.
     * Uses the git/trees recursive endpoint + per-blob fetches.
     */
    async pullFiles(token, repoId, branch, opts = {}) {
        const baseUrl = this._baseUrl(opts)
        const [owner, repo] = repoId.split('/')

        // Get the commit SHA for the branch, then fetch the full recursive tree.
        const branchData = await _request(token, baseUrl, `repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`)
        const commitSha = branchData.commit.id

        const treeData = await _request(
            token, baseUrl,
            `repos/${owner}/${repo}/git/trees/${commitSha}?recursive=true`
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
}
