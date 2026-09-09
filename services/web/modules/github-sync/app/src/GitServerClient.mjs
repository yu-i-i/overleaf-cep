import logger from '@overleaf/logger'

/**
 * Client for GitHubInterface microservice
 */
export class GitServerClient {
  constructor() {
    this.apiUrl = process.env.GITHUBINTERFACE_API_URL || 'http://localhost:4013'
    // GS-11: bounded timeouts — a hung githubinterface must not hang user
    // requests indefinitely (merge lock is held during these calls).
    this.defaultTimeoutMs = 60 * 1000
    this.longTimeoutMs = 9 * 60 * 1000
    // GS-11/GHI-01: forward the shared service token when the env is set, so
    // the service's SHARED_SERVICE_TOKEN gate (when enabled) is satisfied.
    const serviceToken = process.env.SHARED_SERVICE_TOKEN
    this.serviceHeaders = serviceToken ? { 'x-service-token': serviceToken } : {}
  }

  headers() {
    return { 'Content-Type': 'application/json', ...this.serviceHeaders }
  }

  async _post(path, body, timeoutMs) {
    return fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
  }

  /**
   * Check connection to a git server
   */
  async check(serverUrl, username, token) {
    try {
      const response = await this._post(
        '/check',
        {
          server_url: serverUrl,
          username,
          token // Use token directly, not password
        },
        this.defaultTimeoutMs
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to connect to git server: ${errorText}`)
      }

      logger.debug({ serverUrl }, 'Git server check completed')
      return true
    } catch (err) {
      logger.error({ err, serverUrl }, 'Git server check failed')
      throw err
    }
  }

  /**
   * Clone a repository. Accepts either a full https URL or a repo full
   * name (owner/name) plus the server URL.
   */
  async clone(repoUrlOrName, ref, targetDir, serverUrl, username, token) {
    const repoUrl = /^https?:\/\//i.test(repoUrlOrName)
      ? repoUrlOrName
      : `${String(serverUrl || '').replace(/\/+$/, '')}/${repoUrlOrName}.git`
    try {
      const response = await this._post(
        '/clone',
        {
          repo_url: repoUrl,
          ref,
          target_dir: targetDir,
          server_url: serverUrl || '',
          username,
          token
        },
        this.longTimeoutMs
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to clone repository: ${errorText}`)
      }

      logger.debug({ repoUrl, targetDir }, 'Repository cloned successfully')
      return true
    } catch (err) {
      logger.error({ err, repoUrl, ref, targetDir }, 'Git clone failed')
      throw err
    }
  }

  /**
   * Push to remote repository
   */
  async push(dir, remote = 'origin', ref = 'HEAD', serverUrl, username, token) {
    try {
      const response = await this._post(
        '/push',
        { dir, remote, ref, server_url: serverUrl, username, token },
        this.defaultTimeoutMs
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to push: ${errorText}`)
      }

      logger.debug({ dir, remote }, 'Git push completed')
      return true
    } catch (err) {
      logger.error({ err, dir, remote }, 'Git push failed')
      throw err
    }
  }

  /**
   * Pull from remote repository
   */
  async pull(dir, remote = 'origin', ref = 'HEAD', serverUrl, username, token) {
    try {
      const response = await this._post(
        '/pull',
        { dir, remote, ref, server_url: serverUrl, username, token },
        this.defaultTimeoutMs
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to pull: ${errorText}`)
      }

      logger.debug({ dir, remote }, 'Git pull completed')
      return true
    } catch (err) {
      logger.error({ err, dir, remote }, 'Git pull failed')
      throw err
    }
  }

  /**
   * Create a commit
   */
  async commit(dir, files, message, author = null, serverUrl, username, token) {
    try {
      const response = await this._post(
        '/commit',
        { dir, files, message, author, server_url: serverUrl, username, token },
        this.defaultTimeoutMs
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create commit: ${errorText}`)
      }

      const data = await response.json()
      logger.debug({ dir, commit_sha: data.commit_sha }, 'Git commit created')
      return data
    } catch (err) {
      logger.error({ err, dir, message, fileCount: files?.length || 0 }, 'Git commit failed')
      throw err
    }
  }

  /**
   * Get commit history
   */
  async log(dir, ref = 'HEAD', { limit = 50, page = 1 } = {}, serverUrl, username, token) {
    try {
      const url = `${this.apiUrl}/log?dir=${encodeURIComponent(dir)}&ref=${encodeURIComponent(ref)}&limit=${limit}&page=${page}`

      const headers = new Headers()
      Object.entries(this.serviceHeaders).forEach(([k, v]) => headers.set(k, v))
      if (serverUrl && username && token) {
        headers.set('X-Server-Url', serverUrl)
        headers.set('X-Username', username)
        // E.3: the /log endpoint never reads an Authorization header (verified
        // against githubinterface server.mjs) — the Bearer PAT was dead weight.
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(this.defaultTimeoutMs)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get log: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      logger.error({ err, dir, ref }, 'Git log failed')
      throw err
    }
  }

  /**
   * Verify token can access a repository
   */
  async canPush(repoFullName, serverUrl, username, token) {
    try {
      const response = await this._post(
        '/can-push',
        { server_url: serverUrl, repo: repoFullName, username, token },
        this.defaultTimeoutMs
      )

      if (response.ok) {
        const data = await response.json()
        return data?.can_push !== false
      }
      // 403/404 -> no access
      return false
    } catch (err) {
      logger.error({ err, repoFullName }, 'canPush check failed')
      throw err
    }
  }

  /**
   * Create a repository on the git server
   */
  async createRepo(repoOptions, serverUrl, username, token) {
    const response = await this._post(
      '/create-repo',
      {
        server_url: serverUrl,
        username,
        token,
        name: repoOptions.name,
        description: repoOptions.description,
        is_public: repoOptions.isPublic !== false,
        org: repoOptions.org
      },
      this.defaultTimeoutMs
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || `Failed to create repository (HTTP ${response.status})`)
    }
    logger.debug({ repoName: repoOptions.name }, 'Repository created')
    return data
  }

  /**
   * List repositories of the token owner
   */
  async listRepos(serverUrl, username, token) {
    const response = await this._post(
      '/list-repos',
      { server_url: serverUrl, username, token },
      this.defaultTimeoutMs
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || `Failed to list repositories (HTTP ${response.status})`)
    }
    return data.repos || []
  }

  /**
   * List user + organizations of the token owner
   */
  async listUserAndOrgs(serverUrl, username, token) {
    const orgsRes = await this._post(
      '/orgs',
      { server_url: serverUrl, username, token },
      this.defaultTimeoutMs
    )
    const orgsData = await orgsRes.json().catch(() => ({}))
    return {
      // Prefer the authenticated login reported by the service; fall back to
      // the stored username.
      user: orgsData.user || username || '',
      orgs: orgsRes.ok ? (orgsData.orgs || []) : []
    }
  }

  /**
   * Resolve a branch to its head commit sha
   */
  async getBranchHead(repoFullName, branchName, serverUrl, username, token) {
    const response = await this._post(
      '/branch-head',
      { server_url: serverUrl, repo: repoFullName, branch: branchName, username, token },
      this.defaultTimeoutMs
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || `Failed to resolve branch (HTTP ${response.status})`)
    }
    return data.sha
  }

  /**
   * List commits on a branch newer than since; reports divergence
   */
  async getCommitsWithStatus(repoFullName, branchName, sinceCommit, serverUrl, username, token) {
    const response = await this._post(
      '/commits',
      {
        server_url: serverUrl,
        repo: repoFullName,
        branch: branchName,
        since: sinceCommit,
        username,
        token
      },
      this.longTimeoutMs
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || `Failed to list commits (HTTP ${response.status})`)
    }
    return { commits: data.commits || [], diverged: !!data.diverged }
  }

  /**
   * Get git status
   */
  async status(dir, serverUrl, username, token) {
    try {
      const url = `${this.apiUrl}/status?dir=${encodeURIComponent(dir)}`

      const headers = new Headers()
      Object.entries(this.serviceHeaders).forEach(([k, v]) => headers.set(k, v))
      if (serverUrl && username && token) {
        headers.set('X-Server-Url', serverUrl)
        headers.set('X-Username', username)
        // E.3: the /status endpoint never reads an Authorization header (verified
        // against githubinterface server.mjs) — the Bearer PAT was dead weight.
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(this.defaultTimeoutMs)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get status: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      logger.error({ err, dir }, 'Git status failed')
      throw err
    }
  }
}

export default GitServerClient
