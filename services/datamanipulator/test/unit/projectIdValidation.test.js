import process from 'node:process'
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'

describe('server project_id validation (P0-1 / C6)', () => {
  let app

  beforeAll(async () => {
    // Bind to an ephemeral port; keep degraded auth mode for tests.
    process.env.DATAMANIPULATOR_PORT = '0'
    process.env.SHARED_SERVICE_TOKEN = ''
    const mod = await import('../../app/src/server.mjs')
    app = mod.default
  })

  const VALID_ID = '5f3a1b2c4d5e'

  it('rejects traversal project_id on /tree with 400', async () => {
    const res = await request(app)
      .get('/tree')
      .query({ project_id: '../../etc' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid project_id/)
  })

  it('rejects traversal project_id on DELETE /file with 400', async () => {
    const res = await request(app)
      .delete('/file')
      .query({ project_id: '../../../../..', path: 'passwd' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid project_id/)
  })

  it('rejects double-encoded traversal on GET /file with 400', async () => {
    const res = await request(app)
      .get('/file')
      .query({ project_id: '%2e%2e%2f%2e%2e%2fetc', path: 'passwd' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid project_id/)
  })

  it('rejects a 13-character id on /push with 400', async () => {
    const res = await request(app).post('/push').query({ project_id: VALID_ID + 'a' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid project_id/)
  })

  it('rejects missing project_id on /pull with 400', async () => {
    const res = await request(app).post('/pull')
    expect(res.status).toBe(400)
  })

  it('accepts a well-formed 12-hex id (passes validation; 404 = dir missing)', async () => {
    const res = await request(app).get('/tree').query({ project_id: VALID_ID })
    expect(res.status).not.toBe(400)
    expect(res.status).toBe(404)
  })
})
