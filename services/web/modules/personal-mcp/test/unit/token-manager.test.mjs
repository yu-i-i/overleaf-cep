import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { ObjectId } from 'mongodb'
import {
  createTokenManager,
  PERSONAL_MCP_SCOPE,
  TOKEN_PREFIX,
  TOKEN_TYPE,
} from '../../app/src/PersonalMcpTokenManager.mjs'

const USER1 = new ObjectId()
const USER2 = new ObjectId()

// Minimal in-memory stand-in for the two collections the manager touches.
function createFakeDb() {
  const tokens = []
  const users = new Map()
  const db = {
    oauthAccessTokens: {
      insertOne: async doc => {
        const _id = new ObjectId()
        tokens.push({ _id, ...doc })
        return { insertedId: _id }
      },
      find: query => {
        const result = {
          sort: () => result,
          toArray: async () => tokens.filter(doc => matches(doc, query)),
        }
        return result
      },
      findOne: async query =>
        tokens.find(doc => matches(doc, query)) ?? null,
      updateOne: async (query, update) => {
        const doc = tokens.find(d => matches(d, query))
        if (doc) Object.assign(doc, update.$set)
        return { modifiedCount: doc ? 1 : 0 }
      },
      deleteOne: async query => {
        const i = tokens.findIndex(doc => matches(doc, query))
        if (i >= 0) tokens.splice(i, 1)
        return { deletedCount: i >= 0 ? 1 : 0 }
      },
      deleteMany: async query => {
        let n = 0
        for (let i = tokens.length - 1; i >= 0; i--) {
          if (matches(tokens[i], query)) {
            tokens.splice(i, 1)
            n++
          }
        }
        return { deletedCount: n }
      },
      countDocuments: async query =>
        tokens.filter(doc => matches(doc, query)).length,
    },
    users: {
      findOne: async query => users.get(String(query._id)) ?? null,
    },
  }
  return { db, tokens, users }
}

function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    const value = doc[key]
    if (cond !== null && typeof cond === 'object' && '$gt' in cond) {
      return value != null && value > cond.$gt
    }
    if (value instanceof ObjectId || cond instanceof ObjectId) {
      return String(value) === String(cond)
    }
    return value === cond
  })
}

const tick = () => new Promise(resolve => setImmediate(resolve))

describe('PersonalMcpTokenManager', () => {
  let fake, manager

  beforeEach(() => {
    fake = createFakeDb()
    fake.users.set(String(USER1), { _id: USER1, suspended: false })
    fake.users.set(String(USER2), { _id: USER2, suspended: false })
    manager = createTokenManager({ db: fake.db })
  })

  it('stores only the sha256 hash and returns the raw token once', async () => {
    const created = await manager.createToken(USER1, 'laptop')
    expect(created.token.startsWith(TOKEN_PREFIX)).toBe(true)
    expect(created.purpose).toEqual('laptop')
    const stored = fake.tokens[0]
    expect(stored.accessToken).toEqual(
      crypto.createHash('sha256').update(created.token).digest('hex')
    )
    expect(JSON.stringify(fake.tokens)).not.toContain(created.token)
    expect(stored.accessTokenPartial).toEqual(created.token.substring(0, 12))
    expect(stored.scope).toEqual(PERSONAL_MCP_SCOPE)
    expect(stored.type).toEqual(TOKEN_TYPE)
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toEqual(
      90 * 24 * 60 * 60 * 1000
    )
  })

  it('authenticates a valid token to its owner id', async () => {
    const created = await manager.createToken(USER1)
    const identity = await manager.authenticateToken(created.token)
    expect(identity).toEqual({
      userId: String(USER1),
      tokenId: created.id,
    })
    await tick() // fire-and-forget lastUsedAt update
    expect(fake.tokens[0].lastUsedAt).toBeInstanceOf(Date)
  })

  it('rejects malformed, unknown and expired tokens', async () => {
    expect(await manager.authenticateToken('not-a-token')).toBeNull()
    expect(await manager.authenticateToken('olm_short')).toBeNull()
    const created = await manager.createToken(USER1)
    fake.tokens[0].expiresAt = new Date(Date.now() - 1000)
    expect(await manager.authenticateToken(created.token)).toBeNull()
  })

  it('never authenticates one token family for the other scope', async () => {
    const created = await manager.createToken(USER1)
    // simulate a git-bridge PAT document: same collection, other scope
    fake.tokens.push({
      _id: new ObjectId(),
      accessToken: fake.tokens[0].accessToken,
      user_id: USER2,
      type: TOKEN_TYPE,
      scope: 'git_bridge',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    })
    fake.tokens[0].scope = 'git_bridge'
    expect(await manager.authenticateToken(created.token)).toBeNull()
  })

  it('rejects tokens of suspended or deleted users', async () => {
    const created = await manager.createToken(USER1)
    fake.users.set(String(USER1), { _id: USER1, suspended: true })
    expect(await manager.authenticateToken(created.token)).toBeNull()
    fake.users.delete(String(USER1))
    expect(await manager.authenticateToken(created.token)).toBeNull()
  })

  it('lists only own tokens and never leaks the hash', async () => {
    const created = await manager.createToken(USER1, 'mine')
    await manager.createToken(USER2, 'theirs')
    const list = await manager.listTokens(USER1)
    expect(list.length).toEqual(1)
    expect(list[0].id).toEqual(created.id)
    expect(list[0].purpose).toEqual('mine')
    expect(list[0].partial).toEqual(created.token.substring(0, 12))
    expect('accessToken' in list[0]).toBe(false)
    expect(await manager.countForUser(USER1)).toEqual(1)
    expect(await manager.countForUser(USER2)).toEqual(1)
  })

  it('lets a user revoke only their own tokens', async () => {
    const created = await manager.createToken(USER1)
    expect(await manager.revokeToken(USER2, created.id)).toBe(false)
    expect(await manager.countForUser(USER1)).toEqual(1)
    expect(await manager.revokeToken(USER1, 'not-an-object-id')).toBe(false)
    expect(await manager.revokeToken(USER1, created.id)).toBe(true)
    expect(await manager.countForUser(USER1)).toEqual(0)
    expect(await manager.authenticateToken(created.token)).toBeNull()
  })

  it('deletes all tokens for an expired user only for that user', async () => {
    await manager.createToken(USER1)
    await manager.createToken(USER2)
    expect(await manager.deleteAllForUser(USER1)).toEqual(1)
    expect(fake.tokens.length).toEqual(1)
    expect(String(fake.tokens[0].user_id)).toEqual(String(USER2))
  })
})
