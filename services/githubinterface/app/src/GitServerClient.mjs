import * as git from 'isomorphic-git'
import fs from 'fs'
import logger from '@overleaf/logger'

export class GitServerClient {
  constructor(serverUrl, username, password) {
    this.serverUrl = serverUrl.replace(/\/$/, '')
    this.username = username
    this.password = password
  }

  /**
   * List remote repositories (for GitHub/GitLab APIs)
   */
  async listRepos() {
    try {
      // For git servers, we can list refs from the root
      const repos = await git.listRemoteRefs({
        url: this.serverUrl,
        username: this.username,
        password: this.password
      })
      
      logger.debug({ serverUrl: this.serverUrl, repoCount: Object.keys(repos).length }, 'Repos listed')
      return repos
    } catch (err) {
      logger.error({ err, serverUrl: this.serverUrl }, 'Failed to list repos')
      throw err
    }
  }

  /**
   * Create a new repository
   */
  async createRepo(repoOptions) {
    try {
      // Git protocol doesn't have repo creation - this would need to be done via API
      // For multi-server support, we return a placeholder and rely on manual repo creation
      logger.debug({ repoOptions }, 'Repository creation via git protocol not supported')
      return { error: 'Repo creation requires API access' }
    } catch (err) {
      logger.error({ err, repoOptions }, 'Failed to create repo')
      throw err
    }
  }

  /**
   * Validate connection to the Git server
   */
  async check() {
    // Try to list repository contents at root - will fail for non-repo but proves connectivity
    try {
      const repos = await git.listRemoteRefs({
        url: this.serverUrl,
        username: this.username,
        password: this.password
      })
      
      logger.debug({ 
        serverUrl: this.serverUrl, 
        reposCount: Object.keys(repos).length 
      }, 'Git server check completed')
    } catch (err) {
      logger.error({ err, serverUrl: this.serverUrl }, 'Git server check failed')
      throw err
    }
  }

  /**
   * Clone a repository to target directory
   */
  async clone(repoUrl, ref = 'HEAD', targetDir) {
    try {
      await git.clone({
        fs,
        dir: targetDir,
        url: repoUrl,
        ref,
        username: this.username,
        password: this.password
      })
      
      logger.debug({ 
        repoUrl, 
        targetDir, 
        ref 
      }, 'Repository cloned successfully')
      
      return { success: true }
    } catch (err) {
      logger.error({ err, repoUrl, ref, targetDir }, 'Git clone failed')
      throw err
    }
  }

  /**
   * Push local commits to remote
   */
  async push(dir, remote = 'origin', ref = 'HEAD') {
    try {
      const result = await git.push({
        fs,
        dir,
        remote,
        ref,
        username: this.username,
        password: this.password
      })
      
      logger.debug({ 
        dir, 
        remote, 
        ref,
        pushedCount: result?.length || 0 
      }, 'Git push completed')
      
      return { success: true, pushed_count: result?.length || 0 }
    } catch (err) {
      logger.error({ err, dir, remote, ref }, 'Git push failed')
      throw err
    }
  }

  /**
   * Pull from remote to local
   */
  async pull(dir, remote = 'origin', ref = 'HEAD') {
    try {
      const result = await git.pull({
        fs,
        dir,
        remote,
        ref,
        username: this.username,
        password: this.password
      })
      
      logger.debug({ 
        dir, 
        remote, 
        ref,
        mergedCount: result?.length || 0 
      }, 'Git pull completed')
      
      return { success: true, pulled_count: result?.length || 0 }
    } catch (err) {
      logger.error({ err, dir, remote, ref }, 'Git pull failed')
      throw err
    }
  }

  /**
   * Create a new commit
   */
  async commit(dir, files, message, author = null) {
    try {
      // Add all files to index
      await git.add({
        fs,
        dir,
        filepath: files.map(f => f.path)
      })
      
      // Get current HEAD
      const head = await git.resolveRef({ fs, dir, ref: 'HEAD' })
      
      // Create tree from staged changes
      await git.writeTree({ fs, dir })
      
      // Create commit
      const commitSha = await git.commit({
        fs,
        dir,
        message,
        author: author || { name: this.username },
        parents: [head]
      })
      
      logger.debug({ 
        dir, 
        commitSha,
        fileCount: files.length 
      }, 'Git commit created')
      
      return commitSha
    } catch (err) {
      logger.error({ err, dir, message, fileCount: files?.length || 0 }, 'Git commit failed')
      throw err
    }
  }

  /**
   * Get commit history
   */
  async log(dir, ref = 'HEAD', { limit = 50, page = 1 } = {}) {
    try {
      const commits = []
      let skipCount = (page - 1) * limit
      
      for await (const commit of git.log({
        fs,
        dir,
        ref,
        maxCount: limit + skipCount
      })) {
        if (skipCount > 0) {
          skipCount--
          continue
        }
        
        commits.push({
          sha: commit.oid,
          message: commit.commit.message,
          author: {
            name: commit.commit.author.name,
            email: commit.commit.author.email,
            date: new Date(commit.commit.author.timestamp * 1000).toISOString()
          },
          parents: commit.parents
        })
      }
      
      logger.debug({ 
        dir, 
        ref,
        page,
        limit,
        commitsCount: commits.length 
      }, 'Git log retrieved')
      
      return {
        commits,
        has_more: commits.length >= limit,
        current_page: page
      }
    } catch (err) {
      logger.error({ err, dir, ref }, 'Git log failed')
      throw err
    }
  }

  /**
   * Get git status
   */
  async status(dir) {
    try {
      const status = await git.statusMatrix({
        fs,
        dir
      })
      
      // Convert status matrix to human-readable format
      const uncommittedFiles = []
      for (const [filepath, [, stagedStatus, workingTreeStatus]] of status.entries()) {
        if (stagedStatus !== 0 || workingTreeStatus !== 0) {
          let combinedStatus = ''
          if (workingTreeStatus === 1) combinedStatus += 'M' // modified
          else if (workingTreeStatus === 2) combinedStatus += '?' // untracked
          else if (workingTreeStatus === 3) combinedStatus += 'D' // deleted
          
          if (stagedStatus === 1) combinedStatus = combinedStatus.replace('M', 'A') // staged modified
          else if (stagedStatus === 2 && !combinedStatus.includes('?')) combinedStatus = 'A' // added
          else if (stagedStatus === 3) combinedStatus = 'D' // deleted
            
          uncommittedFiles.push({
            path: filepath,
            status: combinedStatus || '?'
          })
        }
      }
      
      logger.debug({ 
        dir, 
        uncommittedCount: uncommittedFiles.length 
      }, 'Git status retrieved')
      
      return {
        branch: await this._getCurrentBranch(dir),
        ahead: 0, // Would need remote tracking info for accurate count
        behind: 0,
        uncommitted_files: uncommittedFiles
      }
    } catch (err) {
      logger.error({ err, dir }, 'Git status failed')
      throw err
    }
  }

  /**
   * Get current branch name
   */
  async _getCurrentBranch(dir) {
    try {
      const headRef = await git.resolveRef({ fs, dir, ref: 'HEAD' })
      if (headRef.startsWith('refs/heads/')) {
        return headRef.substring('refs/heads/'.length)
      }
      
      // Detached HEAD state
      const oid = await git.readObj({ fs, dir, oid: headRef })
      return `(detached head ${oid.oid.substring(0, 7)})`
    } catch (err) {
      logger.error({ err, dir }, 'Failed to get current branch')
      return '(unknown)'
    }
  }
}

export default GitServerClient
