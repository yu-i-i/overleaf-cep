import crypto from 'node:crypto'
import { ObjectId } from 'mongodb'
import logger from '@overleaf/logger'
import { db as defaultDb } from '../../../../app/src/infrastructure/mongodb.mjs'

// Personal, read-only MCP access tokens.
//
// They live in the same collection as the git-bridge personal access tokens
// (db.oauthAccessTokens) but are namespaced by their own `scope` value and by
// the `olm_` token prefix, so the two token families can never authenticate
// for each other. Only the sha256 hash of the raw token is stored. Expired
// tokens are removed by the existing TTL index on `expiresAt` (migration
// 20230406125632). A suspended user is rejected on every request.

export const TOKEN_PREFIX = 'olm_'
export const TOKEN_TYPE = 'personal_access_token'
export const PERSONAL_MCP_SCOPE = 'personal_mcp_read'
export const DEFAULT_TTL_DAYS = 90
export const MAX_TOKENS_PER_USER = 10

const TOKEN_PATTERN = /^olm_[A-Za-z0-9_-]{43}$/
const TOKEN_TTL_MS = DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function createTokenManager({ db = defaultDb } = {}) {
  function tokenQuery(userId, extra = {}) {
    return {
      ...extra,
      user_id: new ObjectId(String(userId)),
      type: TOKEN_TYPE,
      scope: PERSONAL_MCP_SCOPE,
    }
  }

  async function countForUser(userId) {
    return db.oauthAccessTokens.countDocuments(tokenQuery(userId))
  }

  // Returns the raw token once; it can never be recovered later.
  async function createToken(userId, purpose) {
    const rawToken = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url')
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + TOKEN_TTL_MS)
    const result = await db.oauthAccessTokens.insertOne({
      accessToken: hashToken(rawToken),
      accessTokenPartial: rawToken.substring(0, 12),
      user_id: new ObjectId(String(userId)),
      type: TOKEN_TYPE,
      scope: PERSONAL_MCP_SCOPE,
      purpose: purpose || 'Personal MCP access token',
      createdAt,
      expiresAt,
    })
    return {
      id: result.insertedId.toString(),
      token: rawToken,
      purpose: purpose || 'Personal MCP access token',
      createdAt,
      expiresAt,
    }
  }

  async function listTokens(userId) {
    const docs = await db.oauthAccessTokens
      .find(tokenQuery(userId), {
        projection: {
          accessTokenPartial: 1,
          purpose: 1,
          createdAt: 1,
          expiresAt: 1,
          lastUsedAt: 1,
        },
      })
      .sort({ createdAt: 1 })
      .toArray()
    // Deliberately never includes the accessToken hash.
    return docs.map(doc => ({
      id: doc._id.toString(),
      partial: doc.accessTokenPartial,
      purpose: doc.purpose,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt,
      lastUsedAt: doc.lastUsedAt,
    }))
  }

  // Scoped to the owner: it can only delete the user's own tokens.
  async function revokeToken(userId, tokenId) {
    if (!ObjectId.isValid(String(tokenId))) return false
    const result = await db.oauthAccessTokens.deleteOne(
      tokenQuery(userId, { _id: new ObjectId(String(tokenId)) })
    )
    return result.deletedCount === 1
  }

  async function deleteAllForUser(userId) {
    const result = await db.oauthAccessTokens.deleteMany(tokenQuery(userId))
    return result.deletedCount
  }

  // Returns { userId, tokenId } or null. The caller must derive every
  // authorization decision from the returned userId, never from request data.
  async function authenticateToken(token) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null
    const entry = await db.oauthAccessTokens.findOne(
      {
        accessToken: hashToken(token),
        type: TOKEN_TYPE,
        scope: PERSONAL_MCP_SCOPE,
        expiresAt: { $gt: new Date() },
      },
      { projection: { user_id: 1 } }
    )
    if (!entry || !entry.user_id) return null
    const userId = entry.user_id.toString()
    if (!ObjectId.isValid(userId)) return null
    const user = await db.users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { _id: 1, suspended: 1 } }
    )
    if (!user || user.suspended) return null
    // Non-blocking usage stamp. Never log the token itself.
    db.oauthAccessTokens
      .updateOne({ _id: entry._id }, { $set: { lastUsedAt: new Date() } })
      .catch(err =>
        logger.warn(
          { err },
          'personal-mcp: failed to update token lastUsedAt'
        )
      )
    return { userId, tokenId: entry._id?.toString() }
  }

  return {
    countForUser,
    createToken,
    listTokens,
    revokeToken,
    deleteAllForUser,
    authenticateToken,
  }
}

export default createTokenManager()
