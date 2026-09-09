/* global describe, it, beforeAll, afterAll */
import http from 'node:http'
import { expect } from 'vitest'
import UrlAgentModule from '../../../app/src/Features/LinkedFiles/UrlAgent.mjs'

/**
 * R12-15 (2026-08-31): regression test for the template-bundle
 * "Import from URL" 500 —
 *   "UrlAgent.default.fetchWithPolicyRedirects is not a function"
 * fetchWithPolicyRedirects was implemented (and used internally by
 * createLinkedFile) but never exposed on the module surface, while
 * TemplateGalleryManager.importTemplateBundleFromUrl calls it via
 * `UrlAgent.default.fetchWithPolicyRedirects(...)`.
 */
describe('UrlAgent fetchWithPolicyRedirects surface (R12-15)', () => {
  const UrlAgent = UrlAgentModule

  describe('module surface', () => {
    it('is a function on the default export', () => {
      expect(typeof UrlAgent.fetchWithPolicyRedirects).to.equal('function')
    })
    it('is a function on the promises namespace', () => {
      expect(typeof UrlAgent.promises.fetchWithPolicyRedirects).to.equal(
        'function'
      )
    })
    it('the named export is the same behavior (callable, returns a promise)', async () => {
      const { fetchWithPolicyRedirects } = await import(
        '../../../app/src/Features/LinkedFiles/UrlAgent.mjs'
      )
      expect(typeof fetchWithPolicyRedirects).to.equal('function')
    })
  })

  describe('behavior (local HTTP server)', () => {
    let server
    let baseUrl
    const PERMISSIVE = { allowedResourcesRegex: '', blockedNetworks: [] }
    const BLOCKED_LOOPBACK = {
      allowedResourcesRegex: '',
      blockedNetworks: ['127.0.0.0/8'],
    }

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { location: '/bytes' })
          res.end()
          return
        }
        if (req.url === '/bytes') {
          res.writeHead(200, { 'content-type': 'application/octet-stream' })
          res.end(Buffer.from('BUNDLE-123'))
          return
        }
        res.writeHead(404)
        res.end('nope')
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      baseUrl = `http://127.0.0.1:${server.address().port}`
    })

    afterAll(() => {
      server.close()
    })

    it('fetches the body stream directly (async-iterable chunks)', async () => {
      const body = await UrlAgent.fetchWithPolicyRedirects(
        `${baseUrl}/bytes`,
        PERMISSIVE
      )
      const chunks = []
      for await (const chunk of body) chunks.push(chunk)
      const text = Buffer.concat(chunks).toString('utf8')
      expect(text).to.equal('BUNDLE-123')
    })

    it('follows a redirect and re-fetches the target', async () => {
      const body = await UrlAgent.fetchWithPolicyRedirects(
        `${baseUrl}/redirect`,
        PERMISSIVE
      )
      const chunks = []
      for await (const chunk of body) chunks.push(chunk)
      expect(Buffer.concat(chunks).toString('utf8')).to.equal('BUNDLE-123')
    })

    it('rejects with a 403 policy error when the host is in a blocked network', async () => {
      let err = null
      try {
        const body = await UrlAgent.fetchWithPolicyRedirects(
          `${baseUrl}/bytes`,
          BLOCKED_LOOPBACK
        )
        let drained = 0
        for await (const chunk of body) drained += chunk.length
        expect(drained, 'must not have fetched anything').to.equal(0)
      } catch (e) {
        err = e
      }
      expect(err, 'blocked host must throw').to.not.equal(null)
      expect(err.info && err.info.status).to.equal(403)
      expect(String(err.message)).to.match(/blocked/i)
    })
  })
})
