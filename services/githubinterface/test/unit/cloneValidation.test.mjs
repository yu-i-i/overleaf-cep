import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import os from 'node:os'
import Path from 'node:path'
import fs from 'node:fs'

// I.4 — P0-4/C5: /clone must reject non-http(s) repo URLs (file:// local
// repository disclosure) and host-mismatched URLs (SSRF). Validation happens
// before any git execution, so no client mocking is needed.

let app
let closeApp = () => {}

beforeAll(async () => {
  // deterministic service work root + absolute target dirs (route requires
  // target_dir absolute within the work root)
  const workRoot = Path.join(fs.mkdtempSync(Path.join(os.tmpdir(), 'ghif-test-')), 'work')
  fs.mkdirSync(workRoot, { recursive: true })
  globalThis.__GHIF_WORK_ROOT__ = workRoot
  process.env.GITHUBINTERFACE_WORKDIR_ROOT = workRoot
  process.env.GITHUBINTERFACE_PORT = '0' // ephemeral; never collide with the live service
  const mod = await import('../../app/src/server.mjs')
  app = request(mod.default)
  const handle = mod.default._server
  closeApp = () => { if (handle) return new Promise(r => handle.close(r)) }
})

const targetDir = () => Path.join(globalThis.__GHIF_WORK_ROOT__, 'clone-test')

afterAll(async () => {
  await closeApp()
  if (globalThis.__GHIF_WORK_ROOT__) {
    fs.rmSync(Path.dirname(globalThis.__GHIF_WORK_ROOT__), { recursive: true, force: true })
  }
})

describe('githubinterface /clone URL validation (C5)', () => {
  it('rejects file:// repo_url (local git repo disclosure)', async () => {
    const res = await app
      .post('/clone')
      .send({ repo_url: 'file:///etc/git/repo', target_dir: targetDir() })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/must be an http\(s\) URL/i)
  })

  it('rejects a plain-http (insecure) repo_url when no server_url is given', async () => {
    const res = await app
      .post('/clone')
      .send({ repo_url: 'http://127.0.0.1:4000/repo.git', target_dir: targetDir() })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/insecure repo_url/i)
  })

  it('rejects repo_url whose host does not match the provided server_url', async () => {
    const res = await app
      .post('/clone')
      .send({
        repo_url: 'https://evil.example.com/repo.git',
        server_url: 'https://git.example.com',
        target_dir: targetDir(),
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/host must match/i)
  })

  it('missing required fields → 400 (basic validation unchanged)', async () => {
    const res = await app.post('/clone').send({ target_dir: targetDir() })
    expect(res.status).toBe(400)
  })
})
