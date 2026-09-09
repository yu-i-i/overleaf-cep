import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import os from 'node:os'
import Path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import * as igit from 'isomorphic-git'

// GHI-12 regression: /commit must produce a real commit.
// isomorphic-git v1 requires an explicit `tree` for git.commit; the previous
// implementation discarded the writeTree result and every /commit failed with
// `The function requires a "tree" parameter but none was provided.` — which
// broke git-sync export for every provider.

let app
let closeApp = () => {}
let workRoot = null

beforeAll(async () => {
  workRoot = Path.join(fs.mkdtempSync(Path.join(os.tmpdir(), 'ghif-commit-test-')), 'work')
  fs.mkdirSync(workRoot, { recursive: true })
  globalThis.__GHIF_WORK_ROOT__ = workRoot
  process.env.GITHUBINTERFACE_WORKDIR_ROOT = workRoot
  process.env.GITHUBINTERFACE_PORT = '0' // ephemeral; never collide with the live service
  const mod = await import('../../app/src/server.mjs')
  app = request(mod.default)
  const handle = mod.default._server
  closeApp = () => { if (handle) return new Promise(r => handle.close(r)) }
})

afterAll(async () => {
  await closeApp()
  if (workRoot) fs.rmSync(Path.dirname(workRoot), { recursive: true, force: true })
})

async function makeDirWithFiles() {
  const id = crypto.randomUUID().slice(0, 8)
  const dir = Path.join(workRoot, `commit-test-${id}`)
  fs.mkdirSync(Path.join(dir, 'sub'), { recursive: true })
  fs.writeFileSync(Path.join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n')
  fs.writeFileSync(Path.join(dir, 'sub/note.md'), '# note\n')
  // The production flow clones first; /commit itself requires an initialized
  // repository (isomorphic-git commit reads <gitdir>/HEAD).
  await igit.init({ fs, dir, defaultBranch: 'main' })
  return dir
}

describe('githubinterface /commit (GHI-12)', () => {
  it('creates a commit from staged files (root + subdir)', async () => {
    const dir = await makeDirWithFiles()
    const res = await app
      .post('/commit')
      .send({
        dir,
        files: [{ path: 'main.tex' }, { path: 'sub/note.md' }],
        message: 'Overleaf import',
        author: { name: 'Overleaf Sync', email: 'overleaf-sync@localhost' },
        username: 'tester',
        token: 'test-token',
        server_url: 'https://example.invalid',
      })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.commit_sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('keeps working for a second commit on top of the first', async () => {
    const dir = await makeDirWithFiles()
    // first commit
    const r1 = await app
      .post('/commit')
      .send({
        dir,
        files: [{ path: 'main.tex' }],
        message: 'first',
        author: { name: 'Overleaf Sync', email: 'overleaf-sync@localhost' },
        username: 'tester',
        token: 'test-token',
        server_url: 'https://example.invalid',
      })
    expect(r1.status).toBe(200)
    const firstSha = r1.body.commit_sha

    // modify + second commit
    fs.appendFileSync(Path.join(dir, 'main.tex'), '% edit\n')
    fs.writeFileSync(Path.join(dir, 'sub', 'note.md'), '# note v2\n')
    // isomorphic-git tracks content hashes; stage the changed files
    const r2 = await app
      .post('/commit')
      .send({
        dir,
        files: [{ path: 'main.tex' }, { path: 'sub/note.md' }],
        message: 'second',
        author: { name: 'Overleaf Sync', email: 'overleaf-sync@localhost' },
        username: 'tester',
        token: 'test-token',
        server_url: 'https://example.invalid',
      })
    expect(r2.status).toBe(200)
    expect(r2.body.commit_sha).toMatch(/^[0-9a-f]{40}$/)
    expect(r2.body.commit_sha).not.toBe(firstSha)
  })

  it('rejects unknown paths before committing', async () => {
    const dir = await makeDirWithFiles()
    const res = await app
      .post('/commit')
      .send({
        dir,
        files: [{ path: 'does-not-exist.txt' }],
        message: 'bad',
        author: { name: 'Overleaf Sync', email: 'overleaf-sync@localhost' },
        username: 'tester',
        token: 'test-token',
        server_url: 'https://example.invalid',
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/files not found in dir/)
  })
})
