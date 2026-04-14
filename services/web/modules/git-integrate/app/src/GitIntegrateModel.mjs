/**
 * MongoDB data-access layer for git-integrate per-project connections.
 *
 * Each document in the `gitIntegrateConnections` collection holds the
 * provider type, optional custom base URL, repository identifier, target
 * branch, and the AES-encrypted personal-access token for one Overleaf
 * project.  Tokens are never returned to the browser.
 *
 * Document shape:
 * {
 *   _id:               ObjectId,
 *   project_id:        ObjectId,
 *   provider:          'github' | 'gitlab' | 'gitea' | 'forgejo',
 *   base_url:          string | null,   // custom API root for self-hosted
 *   repo_id:           string,          // "owner/repo" or GitLab project path
 *   branch:            string,
 *   encrypted_token:   string,
 *   last_sync_sha:     string | null,   // SHA of the last successfully synced remote commit
 *   created_at:        Date,
 *   updated_at:        Date,
 * }
 */

import { ObjectId } from 'mongodb'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import { GitIntegrateEncryptor } from './GitIntegrateEncryptor.mjs'

function _coll() {
    return db.gitIntegrateConnections
}

export const GitIntegrateModel = {

    /**
     * Returns the decrypted connection for a project, or null if none exists.
     * The returned object contains { provider, baseUrl, repoId, branch, token }.
     */
    async getConnection(projectId) {
        const doc = await _coll().findOne({ project_id: new ObjectId(projectId) })
        if (!doc) return null
        const decrypted = await GitIntegrateEncryptor.promises.decryptToJson(
            doc.encrypted_token
        )
        return {
            provider: doc.provider,
            baseUrl: doc.base_url || null,
            repoId: doc.repo_id,
            branch: doc.branch,
            token: decrypted.token,
            lastSyncSha: doc.last_sync_sha || null,
            updatedAt: doc.updated_at,
        }
    },

    /**
     * Returns a *redacted* connection status (no token) for display in the UI.
     */
    async getConnectionStatus(projectId) {
        const doc = await _coll().findOne({ project_id: new ObjectId(projectId) })
        if (!doc) return null
        return {
            provider: doc.provider,
            baseUrl: doc.base_url || null,
            repoId: doc.repo_id,
            branch: doc.branch,
            lastSyncSha: doc.last_sync_sha || null,
            updatedAt: doc.updated_at,
        }
    },

    /**
     * Upserts a connection record (encrypts the token before writing).
     */
    async saveConnection(projectId, { provider, baseUrl, repoId, branch, token }) {
        const encrypted = await GitIntegrateEncryptor.promises.encryptJson({ token })
        await _coll().updateOne(
            { project_id: new ObjectId(projectId) },
            {
                $set: {
                    project_id: new ObjectId(projectId),
                    provider,
                    base_url: baseUrl || null,
                    repo_id: repoId,
                    branch: branch || 'main',
                    encrypted_token: encrypted,
                    updated_at: new Date(),
                },
                $setOnInsert: { created_at: new Date() },
            },
            { upsert: true }
        )
    },

    async deleteConnection(projectId) {
        await _coll().deleteOne({ project_id: new ObjectId(projectId) })
    },

    /**
     * Updates the stored SHA of the last successfully synced remote commit.
     * Called after every successful push or pull so conflict detection can
     * determine whether the remote has changed since we last touched it.
     */
    async updateLastSyncSha(projectId, sha) {
        await _coll().updateOne(
            { project_id: new ObjectId(projectId) },
            { $set: { last_sync_sha: sha, updated_at: new Date() } }
        )
    },
}
