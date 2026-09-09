import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'

const FAKE_PASSWORD = 'Sup3rSecretPW!do-not-leak'

// Hoisted mock: server.mjs does `new WebDAVClient(...)` per request.
const { clientCheck, clientList, clientCreateDirectory } = vi.hoisted(() => ({
  clientCheck: vi.fn(),
  clientList: vi.fn(),
  clientCreateDirectory: vi.fn(),
}))

vi.mock('../../app/src/WebDAVClient.mjs', () => ({
  WebDAVClient: class {
    constructor() {}
    check() { return clientCheck() }
    list() { return clientList() }
    createDirectory() { return clientCreateDirectory() }
    download() { return Promise.resolve('') }
    upload() { return Promise.resolve() }
    move() { return Promise.resolve() }
  },
}))

let closeApp = () => {}

async function loadServer({ serviceToken } = {}) {
  vi.resetModules()
  if (serviceToken === undefined) delete process.env.SHARED_SERVICE_TOKEN
  else process.env.SHARED_SERVICE_TOKEN = serviceToken
  // ephemeral port so tests never collide with a running service
  process.env.WEBDAVINTERFACE_PORT = '0'
  const mod = await import('../../app/src/server.mjs')
  const app = mod.default
  // capture the listening server for clean shutdown
  const handle = app && app._server
  closeApp = () => { if (handle) return new Promise(r => handle.close(r)) }
  return request(app)
}

beforeEach(() => {
  clientCheck.mockReset()
  clientList.mockReset()
  clientCreateDirectory.mockReset()
})

afterAll(async () => {
  await closeApp()
})

describe('webdavinterface server (I.3 — H8 error sanitization + ARC-02 token)', () => {
  describe('degraded mode (SHARED_SERVICE_TOKEN unset)', () => {
    let app

    beforeAll(async () => {
      app = await loadServer({ serviceToken: undefined })
    })

    it('POST /check: provider 401 with credential-looking error → generic 401, no password leak', async () => {
      clientCheck.mockRejectedValueOnce(
        new Error(`HTTP 401: HTTP Authorization Required for http://dav:${FAKE_PASSWORD}@cloud.example.com/remote (unauthorized)`)
      )
      const res = await app
        .post('/check')
        .send({ server_url: 'https://cloud.example.com/dav', username: 'dav', password: FAKE_PASSWORD })

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('authentication failed')
      expect(JSON.stringify(res.body)).not.toContain(FAKE_PASSWORD)
    })

    it('POST /list: provider 404 → 404 not found, no raw provider text', async () => {
      clientList.mockRejectedValueOnce(new Error('HTTP 404: not found at http://dav:whatever@x/y'))
      const res = await app
        .post('/list')
        .send({ server_url: 'https://cloud.example.com/dav', username: 'dav', password: FAKE_PASSWORD, path: '/nope' })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('not found')
      expect(JSON.stringify(res.body)).not.toContain(FAKE_PASSWORD)
    })

    it('POST /mkdir: precondition-type failure → 409 "modified since last sync" (no provider text)', async () => {
      clientCreateDirectory.mockRejectedValueOnce(
        new Error(`HTTP 412: Precondition Failed for http://dav:${FAKE_PASSWORD}@cloud.example.com/remote`)
      )
      const res = await app
        .post('/mkdir')
        .send({ server_url: 'https://cloud.example.com/dav', username: 'dav', password: FAKE_PASSWORD, path: '/x' })

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('modified since last sync')
      expect(JSON.stringify(res.body)).not.toContain(FAKE_PASSWORD)
    })

    it('POST /check: missing fields → 400 (basic validation unchanged)', async () => {
      const res = await app.post('/check').send({ username: 'u' })
      expect(res.status).toBe(400)
    })
  })

  describe('enforced mode (SHARED_SERVICE_TOKEN set)', () => {
    const TOKEN = 'test-service-token-abc123'

    it('missing/invalid x-service-token → 401; valid token → request proceeds', async () => {
      clientCheck.mockResolvedValueOnce({ ok: true })
      const app = await loadServer({ serviceToken: TOKEN })

      const denied = await app
        .post('/check')
        .send({ server_url: 'https://cloud.example.com/dav', username: 'dav', password: FAKE_PASSWORD })
      expect(denied.status).toBe(401)
      expect(denied.body.error).toMatch(/service token/i)

      const allowed = await app
        .post('/check')
        .set('x-service-token', TOKEN)
        .send({ server_url: 'https://cloud.example.com/dav', username: 'dav', password: FAKE_PASSWORD })
      expect(allowed.status).toBe(200)
      expect(allowed.body.status).toBe('ok')
    })

    it('bearer header form is also accepted', async () => {
      clientCheck.mockResolvedValueOnce({ ok: true })
      const app = await loadServer({ serviceToken: TOKEN })
      const res = await app
        .post('/check')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({ server_url: 'https://cloud.example.com/dav', username: 'dav', password: FAKE_PASSWORD })
      expect(res.status).toBe(200)
    })
  })
})
