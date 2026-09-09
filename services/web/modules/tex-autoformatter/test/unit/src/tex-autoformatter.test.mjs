// tex-autoformatter module — unit tests (ported 2026-08-31 from CE+
// autoformat, commit e5edadaa; reviewed + bug-checked during the port).
//
// Coverage:
//  * module shape (router apply)   — boot-contract parity
//  * controller: validation (400)
//  * controller: .bib path        — real bibtex-tidy transform (deterministic)
//  * controller: .tex path        — real tex-fmt binary, skipped when absent
//                                   (dev hosts without the vendored binary)
//
// The live E2E (toolbar button in the editor + CSRF-protected POST) is
// covered by the E2E checklist in BUGHUNT_REPORT2.md.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import moduleDefault from '../../../index.mjs'
import controller from '../../../app/src/TexAutoformatterController.mjs'

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
  return res
}

function makeReq(body) {
  return { body, session: {} }
}

describe('tex-autoformatter module', () => {
  it('exposes a router with an apply(fn) handler', () => {
    expect(moduleDefault.router).toBeTruthy()
    expect(typeof moduleDefault.router.apply).toBe('function')
  })

  it('router registers exactly one route: POST /api/format-tex', async () => {
    const seen = []
    const fakeRouter = {
      post: (path, ...handlers) => seen.push({ method: 'POST', path, handlers }),
      get: () => seen.push({ method: 'GET' }),
    }
    moduleDefault.router.apply(fakeRouter)
    expect(seen.length).toBe(1)
    expect(seen[0].method).toBe('POST')
    expect(seen[0].path).toBe('/api/format-tex')
    // last handler is the controller action
    expect(seen[0].handlers.at(-1)).toBe(controller.formatTex)
  })
})

describe('TexAutoformatterController.formatTex', () => {
  it('rejects non-string content with 400', async () => {
    const req = makeReq({ content: 42, filename: 'x.tex' })
    const res = fakeRes()
    await controller.formatTex(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/content/)
  })

  it('rejects over-sized content with 400', async () => {
    const req = makeReq({ content: 'x'.repeat(5 * 1024 * 1024 + 1), filename: 'x.bib' })
    const res = fakeRes()
    await controller.formatTex(req, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/too large/)
  })

  it('formats .bib content via bibtex-tidy (sortFields, curly, trailingCommas)', async () => {
    const input = [
      '@ARTICLE{smith2020,',
      '  author = {Smith, John and Doe, Jane},',
      '  title  = {A paper},',
      '  year   = {2020},',
      '',
      '}',
    ].join('\n')
    const req = makeReq({ content: input, filename: 'refs.bib' })
    const res = fakeRes()
    await controller.formatTex(req, res)
    expect(res.statusCode).toBeNull()
    expect(typeof res.body.formatted).toBe('string')
    // deterministic bibtex-tidy invariants
    expect(res.body.formatted).toContain('Smith, John')
    // alignment padding varies, match tolerantly
    expect(res.body.formatted).toMatch(/year\s*=\s*(?:\{2020\}|2020)/)
    // numeric: true renders the year unbraced; fields are re-flowed by
    // bibtex-tidy (align: 14) — no raw double-space before '='
    expect(res.body.formatted).not.toMatch(/title\s{2}=/)
    // trailingCommas: trailing comma before the closing brace
    expect(res.body.formatted).toMatch(/,\s*\}\s*$/)
  })

  const texAvailable = (() => {
    try {
      execFileSync('which', ['tex-fmt'], { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  })()

  // The vendored binary lives in the web server image (/usr/local/bin);
  // pure dev hosts may not have it on PATH — skip rather than fail there.
  const texIt = texAvailable ? it : it.skip
  texIt('formats .tex content via the tex-fmt binary', async () => {
    const input = '\\documentclass{article}\n\\begin{document}Hello\\\\end{document}'
    const req = makeReq({ content: input, filename: 'main.tex' })
    const res = fakeRes()
    await controller.formatTex(req, res)
    expect(res.statusCode).toBeNull()
    expect(typeof res.body.formatted).toBe('string')
    expect(res.body.formatted).toContain('\\documentclass{article}')
  }, 20000)
})
