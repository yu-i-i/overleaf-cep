import { describe, expect, it, vi, afterEach } from 'vitest'
import http from 'node:http'

// DropboxRouter imports a lot of app-level machinery; none of it is exercised
// by the token-refresh logic under test here, so stub the heavy modules to
// keep the import graph light and deterministic.
vi.mock('../../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs', () => ({
  default: {
    ensureUserCanWriteProjectContent: () => (req, res, next) => next(),
  },
}))
vi.mock('../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
  default: { promises: { getProject: async () => null } },
}))
vi.mock('../../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/Editor/EditorController.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs', () => ({
  default: { promises: { flushProjectToMongo: async () => true } },
}))
vi.mock('../../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('../../../../../app/src/Features/History/HistoryManager.mjs', () => ({
  default: { promises: {} },
}))
vi.mock('@overleaf/settings', () => ({ default: {} }))

// Deterministic fake encryption: reversible, no environment secrets needed.
vi.mock('../../../app/src/DropboxCredentials.mjs', () => ({
  encryptToken: t => 'enc:' + Buffer.from(String(t), 'utf8').toString('base64'),
  decryptToken: e => {
    if (typeof e === 'string' && e.startsWith('enc:')) {
      return Buffer.from(e.slice(4), 'base64').toString('utf8')
    }
    throw new Error('Invalid encrypted data format')
  },
  getEncryptionKey: () => Buffer.from('0'.repeat(32)),
}))

// Controllable credentials-model mock.
const modelState = vi.hoisted(() => ({
  doc: null,
  updates: [],
  findOne: async () => modelState.doc,
  findOneAndUpdate: async (query, update) => {
    modelState.updates.push({ query, update })
    return modelState.doc
  },
}))
vi.mock('../../../app/models/dropboxUserCredentials.mjs', () => ({
  DropboxUserCredentials: {
    findOne: modelState.findOne,
    findOneAndUpdate: modelState.findOneAndUpdate,
  },
}))

const { default: DropboxClient } = await import('../../../app/src/DropboxClient.mjs')
const { getFreshDropboxAccessToken } = await import('../../../app/src/DropboxRouter.mjs')

const enc = t => 'enc:' + Buffer.from(t, 'utf8').toString('base64')
const auth401 = msg => Object.assign(new Error(msg || 'Dropbox: Unauthorized - expired_access_token'), { status: 401 })

// This vitest/chai setup doesn't handle the `rejects` matcher reliably —
// capture the rejection explicitly.
async function captureRejection(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  return null
}

function makeExpiredFetch(result = { access_token: 'NEW_A', refresh_token: 'NEW_R' }) {
  const fetchMock = vi.fn(async () => {
    if (result.__fail) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_summary: 'invalid_grant/' }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ ...result }) }
  })
  globalThis.fetch = fetchMock
  return fetchMock
}

afterEach(() => {
  vi.restoreAllMocks()
  modelState.doc = null
  modelState.updates = []
  process.env.DROPBOX_APP_KEY = undefined
  process.env.DROPBOX_APP_SECRET = undefined
})

describe('DropboxClient token-refresh retry', () => {
  it('refreshes an expired token once and retries the request', async () => {
    const onTokenExpired = vi.fn(async () => 'NEW_TOKEN')
    const client = new DropboxClient({ accessToken: 'OLD_TOKEN', onTokenExpired })

    let calls = 0
    client._requestOnce = async () => {
      calls += 1
      if (calls === 1) throw auth401()
      return { ok: true, token: client.accessToken }
    }

    const result = await client._request('/list', { method: 'POST' })
    expect(calls).toBe(2)
    expect(onTokenExpired).toHaveBeenCalledTimes(1)
    expect(onTokenExpired).toHaveBeenCalledWith('OLD_TOKEN')
    expect(result.token).toBe('NEW_TOKEN')
    expect(client.accessToken).toBe('NEW_TOKEN')
  })

  it('surfaces a clear 409 when the refresh has no stored refresh token', async () => {
    const onTokenExpired = vi.fn(async () => {
      throw Object.assign(new Error('no refresh token'), { reauthRequired: true })
    })
    const client = new DropboxClient({ accessToken: 'OLD', onTokenExpired })
    client._requestOnce = async () => {
      throw auth401()
    }

    const err = await captureRejection(client._request('/list', {}))
    expect(err && err.status).toBe(409)
    expect(err && err.reauthRequired).toBe(true)
    expect(err && err.message).toMatch(/reconnect in Settings/)
  })

  it('throws the original 401 when no refresh callback is configured', async () => {
    const client = new DropboxClient({ accessToken: 'OLD' })
    client._requestOnce = async () => {
      throw auth401()
    }
    const err = await captureRejection(client._request('/list', {}))
    expect(err && err.status).toBe(401)
  })

  it('does not attempt a second refresh if the new token also 401s', async () => {
    const onTokenExpired = vi.fn(async () => 'SECOND_TOKEN')
    const client = new DropboxClient({ accessToken: 'OLD', onTokenExpired })
    client._requestOnce = async () => {
      throw auth401()
    }
    const err = await captureRejection(client._request('/list', {}))
    expect(err && err.status).toBe(401)
    expect(onTokenExpired).toHaveBeenCalledTimes(1)
  })
})

describe('getFreshDropboxAccessToken', () => {
  function setDoc(accessToken, refreshToken) {
    modelState.doc = {
      userId: 'user-1',
      accessToken: accessToken ? enc(accessToken) : undefined,
      refreshToken: refreshToken ? enc(refreshToken) : undefined,
    }
  }

  it('rotates the token pair via oauth2/token and persists both', async () => {
    process.env.DROPBOX_APP_KEY = 'key'
    process.env.DROPBOX_APP_SECRET = 'secret'
    setDoc('CURRENT', 'RT-1')
    const fetchMock = makeExpiredFetch()

    const token = await getFreshDropboxAccessToken('user-1', 'CURRENT')

    expect(token).toBe('NEW_A')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.dropboxapi.com/oauth2/token')
    expect(opts.body.get('grant_type')).toBe('refresh_token')
    expect(opts.body.get('refresh_token')).toBe('RT-1')
    expect(modelState.updates).toHaveLength(1)
    expect(modelState.updates[0].update.$set).toEqual({
      accessToken: enc('NEW_A'),
      refreshToken: enc('NEW_R'),
    })
  })

  it('persists only the access token when Dropbox omits the rotated refresh token', async () => {
    process.env.DROPBOX_APP_KEY = 'key'
    process.env.DROPBOX_APP_SECRET = 'secret'
    setDoc('CURRENT', 'RT-1')
    makeExpiredFetch({ access_token: 'NEW_A_ONLY' })

    const token = await getFreshDropboxAccessToken('user-1', 'CURRENT')

    expect(token).toBe('NEW_A_ONLY')
    expect(modelState.updates[0].update.$set).toEqual({
      accessToken: enc('NEW_A_ONLY'),
    })
  })

  it('reuses the already-rotated token instead of replaying the stale refresh token', async () => {
    process.env.DROPBOX_APP_KEY = 'key'
    process.env.DROPBOX_APP_SECRET = 'secret'
    // The store already holds a DIFFERENT (newer) token than the caller's.
    setDoc('ROTATED_BY_OTHER', 'RT-2')
    const fetchMock = makeExpiredFetch()

    const token = await getFreshDropboxAccessToken('user-1', 'MY_STALE_TOKEN')

    expect(token).toBe('ROTATED_BY_OTHER')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(modelState.updates).toHaveLength(0)
  })

  it('throws reauthRequired when no refresh token is stored', async () => {
    setDoc('CURRENT', undefined)
    const err = await captureRejection(getFreshDropboxAccessToken('user-1', 'CURRENT'))
    expect(err && err.reauthRequired).toBe(true)
  })

  it('throws a refresh-failure error when the token endpoint rejects', async () => {
    process.env.DROPBOX_APP_KEY = 'key'
    process.env.DROPBOX_APP_SECRET = 'secret'
    setDoc('CURRENT', 'RT-1')
    makeExpiredFetch({ __fail: true })

    const err = await captureRejection(getFreshDropboxAccessToken('user-1', 'CURRENT'))
    expect(err && err.message).toMatch(/refresh failed/i)
  })

  it('refreshes only ONCE when two concurrent callers both see an expired token', async () => {
    process.env.DROPBOX_APP_KEY = 'key'
    process.env.DROPBOX_APP_SECRET = 'secret'
    // Simulate the store being rotated while the second refresh is blocked:
    // first call wins; second call must see the new token and skip the API.
    setDoc('CURRENT', 'RT-1')
    const fetchMock = vi.fn(async () => {
      // After the response is "sent", rotate the store like a concurrent winner.
      modelState.doc = {
        userId: 'user-1',
        accessToken: enc('WINNER_TOKEN'),
        refreshToken: enc('RT-2'),
      }
      return { ok: true, status: 200, json: async () => ({ access_token: 'WINNER_TOKEN', refresh_token: 'RT-2' }) }
    })
    globalThis.fetch = fetchMock

    const [a, b] = await Promise.all([
      getFreshDropboxAccessToken('user-1', 'CURRENT'),
      getFreshDropboxAccessToken('user-1', 'CURRENT'),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect([a, b].filter(t => t === 'WINNER_TOKEN')).toHaveLength(2)
  })
})

describe('regression: request body carries the CURRENT token after a refresh', () => {
  // dropboxinterface prefers body.access_token over the X-Access-Token
  // header, so a retry after a mid-flight token swap must send the NEW token
  // in the body as well.
  it('retries with the refreshed token in both header and body', async () => {
    const seen = []
    const server = http.createServer((req, res) => {
      let b = ''
      req.on('data', c => { b += c })
      req.on('end', () => {
        const body = JSON.parse(b || '{}')
        seen.push({ bodyToken: body.access_token, headerToken: req.headers['x-access-token'] })
        if (body.access_token === 'NEW_BODY_TOKEN') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        } else {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'Invalid token' }))
        }
      })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port

    const onTokenExpired = vi.fn(async () => 'NEW_BODY_TOKEN')
    const client = new DropboxClient({
      accessToken: 'OLD_BODY_TOKEN',
      apiUrl: `http://127.0.0.1:${port}`,
      onTokenExpired,
    })

    const result = await client.list('/x', { recursive: false })
    server.close()

    expect(result.ok).toBe(true)
    expect(onTokenExpired).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([
      { bodyToken: 'OLD_BODY_TOKEN', headerToken: 'OLD_BODY_TOKEN' },
      { bodyToken: 'NEW_BODY_TOKEN', headerToken: 'NEW_BODY_TOKEN' },
    ])
  })
})
