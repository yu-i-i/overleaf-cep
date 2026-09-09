import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import http from 'node:http'
import { spawn } from 'node:child_process'
import os from 'node:os'
import Path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

// GHI-13 regression: /commits must report the real commit range since a
// baseline. isomorphic-git v1's log() has no from/to SHA support, so the
// previous implementation threw for every baseline and the merge overview
// always reported "diverged" — even directly after a clean export.
// The handler now enumerates `<since>..HEAD` with the git CLI; this test
// exercises the full path (clone → range log) against a local git
// smart-HTTP backend (git http-backend), which validates as an http(s) URL.

let app
let closeApp = () => {}
let workRoot = null
let bareRoot = null
let server = null
let baseUrl = null

function sh(args, cwd) {
  return pExecFile('git', args, { cwd })
}

beforeAll(async () => {
  const tmp = fs.mkdtempSync(Path.join(os.tmpdir(), 'ghif-commits-test-'))
  workRoot = Path.join(tmp, 'work')
  bareRoot = Path.join(tmp, 'bare')
  fs.mkdirSync(workRoot, { recursive: true })
  fs.mkdirSync(bareRoot, { recursive: true })

  // build a bare repo with three commits: c1 (a.txt v1) → c2 (a.txt v2) → c3 (b.txt)
  const bareDir = Path.join(bareRoot, 'test-repo.git')
  const seed = Path.join(tmp, 'seed')
  fs.mkdirSync(seed, { recursive: true })
  await sh(['init', '-q', '--bare', '-b', 'main', bareDir], bareRoot)
  await sh(['config', 'receive.denyCurrentBranch', 'ignore'], bareDir)
  await sh(['clone', '-q', bareDir, seed], tmp)
  fs.writeFileSync(Path.join(seed, 'a.txt'), 'v1\n')
  await sh(['add', 'a.txt'], seed)
  await sh(['-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '-m', 'c1'], seed)
  fs.writeFileSync(Path.join(seed, 'a.txt'), 'v2\n')
  await sh(['commit', '-qam', 'c2'], seed)
  fs.writeFileSync(Path.join(seed, 'b.txt'), 'b\n')
  await sh(['add', 'b.txt'], seed)
  await sh(['-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '-m', 'c3'], seed)
  await sh(['push', '-q', 'origin', 'main'], seed)
  const c1 = (await sh(['rev-parse', 'HEAD~2'], seed)).stdout.trim()
  const c2 = (await sh(['rev-parse', 'HEAD~1'], seed)).stdout.trim()
  const c3 = (await sh(['rev-parse', 'HEAD'], seed)).stdout.trim()
  globalThis.__SHAs__ = { c1, c2, c3 }
  globalThis.__SEED__ = seed

  // minimal git smart-HTTP server (git http-backend)
  server = http.createServer((req, res) => {
    // CGI protocol: query string is separated from PATH_INFO
    const qIdx = req.url.indexOf('?')
    const env = {
      ...process.env,
      GIT_PROJECT_ROOT: bareRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: req.method,
      PATH_INFO: qIdx === -1 ? req.url : req.url.slice(0, qIdx),
      QUERY_STRING: qIdx === -1 ? '' : req.url.slice(qIdx + 1),
      CONTENT_TYPE: req.headers['content-type'] || '',
      CONTENT_LENGTH: req.headers['content-length'] || '',
    }
    const child = spawn('git', ['http-backend'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    req.pipe(child.stdin)
    let headParsed = false
    let headBuf = Buffer.alloc(0)
    child.stdout.on('data', (d) => {
      if (headParsed) { res.write(d); return }
      headBuf = Buffer.concat([headBuf, d])
      const i = headBuf.indexOf('\r\n\r\n')
      if (i === -1) return
      const headText = headBuf.slice(0, i).toString()
      const rest = headBuf.slice(i + 4)
      const hdrs = {}
      for (const line of headText.split('\r\n')) {
        const m = line.match(/^([^:]+):[ \t]*(.*)$/)
        if (m) hdrs[m[1].toLowerCase()] = m[2]
      }
      res.writeHead(200, hdrs)
      if (rest.length) res.write(rest)
      headParsed = true
    })
    child.stdout.on('end', () => res.end())
    child.stderr.on('data', (d) => {
      if (process.env.GHIF_TEST_DEBUG) process.stderr.write(d)
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  globalThis.__GHIF_WORK_ROOT__ = workRoot
  process.env.GITHUBINTERFACE_WORKDIR_ROOT = workRoot
  process.env.GITHUBINTERFACE_PORT = '0' // ephemeral
  const mod = await import('../../app/src/server.mjs')
  app = request(mod.default)
  const handle = mod.default._server
  closeApp = () => { if (handle) return new Promise(r2 => handle.close(r2)) }
})

afterAll(async () => {
  await closeApp()
  if (server) await new Promise(r => server.close(r))
  if (bareRoot) {
    const tmp = Path.dirname(bareRoot)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

const SHAS = () => globalThis.__SHAs__
function fakeSha() {
  return crypto.randomBytes(20).toString('hex')
}

async function commitsSince(since) {
  const body = { server_url: baseUrl, repo: 'test-repo', branch: 'main', limit: 50, username: 'u', token: '' }
  if (since) body.since = since
  return app.post('/commits').send(body)
}

describe('githubinterface /commits range (GHI-13)', () => {
  it('lists exactly the commits after the baseline (oldest first is not required, count is)', async () => {
    const { c1 } = SHAS()
    const res = await commitsSince(c1)
    expect(res.status).toBe(200)
    // remote-ahead is the NORMAL mergeable case: commits listed, NOT diverged
    // (diverged must stay reserved for the force-push/baseline-lost case)
    expect(res.body.diverged).toBe(false)
    expect(res.body.commits).toHaveLength(2)
    const shas = res.body.commits.map(c => c.sha).sort()
    const { c2, c3 } = SHAS()
    expect(shas).toEqual([c2, c3].sort())
    // each entry keeps message + author for the UI
    expect(res.body.commits[0]).toMatchObject({ sha: expect.any(String), message: expect.any(String), author: expect.objectContaining({ name: expect.any(String) }) })
  })

  it('fresh export case: baseline == HEAD → no commits, NOT diverged', async () => {
    const { c3 } = SHAS()
    const res = await commitsSince(c3)
    expect(res.status).toBe(200)
    expect(res.body.commits).toEqual([])
    expect(res.body.diverged).toBe(false)
  })

  it('baseline not in history (force-push/unknown sha) → diverged with no commits', async () => {
    const res = await commitsSince(fakeSha())
    expect(res.status).toBe(200)
    expect(res.body.commits).toEqual([])
    expect(res.body.diverged).toBe(true)
  })

  it('multi-line commit message → exactly one entry, subject-only message (no %B line-split)', async () => {
    const seed = globalThis.__SEED__
    fs.writeFileSync(Path.join(seed, 'multi.txt'), 'x\n')
    await sh(['add', 'multi.txt'], seed)
    await sh(['-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q',
      '-m', 'multi-subj', '-m', 'body line one', '-m', 'body line two'], seed)
    await sh(['push', '-q', 'origin', 'main'], seed)
    const c4 = (await sh(['rev-parse', 'HEAD'], seed)).stdout.trim()
    const { c2 } = SHAS()
    const res = await commitsSince(c2)
    expect(res.status).toBe(200)
    // c3 + c4 — the multi-line commit must NOT appear as extra entries
    expect(res.body.commits).toHaveLength(2)
    const me = res.body.commits.find(c => c.sha === c4)
    expect(me).toBeTruthy()
    expect(me.message).toBe('multi-subj')
  })

  it('without a baseline: full history (incl. c4), not diverged', async () => {
    const res = await commitsSince(null)
    expect(res.status).toBe(200)
    expect(res.body.commits).toHaveLength(4)
    expect(res.body.diverged).toBe(false)
  })
})
