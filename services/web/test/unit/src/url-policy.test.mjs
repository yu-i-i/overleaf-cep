/* global describe, it */
import { expect } from 'vitest'
import UrlPolicy from '../../../app/src/Features/LinkedFiles/UrlPolicy.mjs'
import LinkedFilesErrors from '../../../app/src/Features/LinkedFiles/LinkedFilesErrors.mjs'

describe('UrlPolicy (3d — SSRF guard for external URL imports)', () => {
  const { ipInCidr, matchesResourceRegex } = UrlPolicy

  describe('ipInCidr', () => {
    it('matches IPv4 private ranges', () => {
      expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).to.equal(true)
      expect(ipInCidr('8.8.8.8', '10.0.0.0/8')).to.equal(false)
      expect(ipInCidr('192.168.10.1', '192.168.0.0/16')).to.equal(true)
      expect(ipInCidr('172.16.5.5', '172.16.0.0/12')).to.equal(true)
      expect(ipInCidr('172.32.0.1', '172.16.0.0/12')).to.equal(false)
      expect(ipInCidr('127.0.0.1', '127.0.0.0/8')).to.equal(true)
      expect(ipInCidr('169.254.1.1', '169.254.0.0/16')).to.equal(true)
    })
    it('handles /32 and /0', () => {
      expect(ipInCidr('1.2.3.4', '1.2.3.4/32')).to.equal(true)
      expect(ipInCidr('1.2.3.5', '1.2.3.4/32')).to.equal(false)
      expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).to.equal(true)
    })
    it('matches IPv6 ranges', () => {
      expect(ipInCidr('::1', '::1/128')).to.equal(true)
      expect(ipInCidr('::2', '::1/128')).to.equal(false)
      expect(ipInCidr('fc00::1', 'fc00::/7')).to.equal(true)
      expect(ipInCidr('fe80::1', 'fe80::/10')).to.equal(true)
      expect(ipInCidr('2001:db8::1', 'fc00::/7')).to.equal(false)
    })
    it('never crashes on garbage and rejects cross-family', () => {
      expect(ipInCidr('not-an-ip', '10.0.0.0/8')).to.equal(false)
      expect(ipInCidr('10.0.0.1', 'gc00::/7')).to.equal(false)
      expect(ipInCidr('::1', '10.0.0.0/8')).to.equal(false)
      expect(ipInCidr('::1', 'no-slash')).to.equal(false)
    })
  })

  describe('matchesResourceRegex', () => {
    it('empty pattern allows everything', () => {
      expect(matchesResourceRegex('https://x.org/a', '')).to.equal(true)
      expect(matchesResourceRegex('https://x.org/a', undefined)).to.equal(true)
    })
    it('enforces the allowlist', () => {
      expect(matchesResourceRegex('https://a.uni-bremen.de/file', '.*\\.uni-bremen\\.de/.*')).to.equal(true)
      expect(matchesResourceRegex('https://evil.org/x', '.*\\.uni-bremen\\.de/.*')).to.equal(false)
    })
    it('a broken admin regex fails closed', () => {
      expect(() => matchesResourceRegex('https://a.org', '([unclosed')).to.throw()
    })
  })

  describe('assertUrlAllowed (allowlist enforcement)', () => {
    it('rejects a url that does not match the allowlist regex (403)', () => {
      const { assertUrlAllowed } = UrlPolicy
      return expect(
        assertUrlAllowed('https://evil.org/x', {
          allowedResourcesRegex: '.*\\.uni-bremen\\.de/.*',
          blockedNetworks: [],
        })
      )
        .to.eventually.be.rejectedWith('site policy')
    })
    it('allows a matching url and a url under an empty allowlist', () => {
      const { assertUrlAllowed } = UrlPolicy
      return Promise.all([
        expect(
          assertUrlAllowed('https://a.uni-bremen.de/file', {
            allowedResourcesRegex: '.*\\.uni-bremen\\.de/.*',
            blockedNetworks: ['10.0.0.0/8'],
          })
        )
          .to.eventually.be.fulfilled,
        expect(
          assertUrlAllowed('https://anything.org/x', {
            allowedResourcesRegex: '',
            blockedNetworks: ['10.0.0.0/8'],
          })
        )
          .to.eventually.be.fulfilled,
      ])
    })
    it('rejects ip-literal hosts inside a blocked network (403)', () => {
      const { assertUrlAllowed } = UrlPolicy
      return expect(
        assertUrlAllowed('http://127.0.0.1:3000/admin', {
          allowedResourcesRegex: '',
          blockedNetworks: ['127.0.0.0/8'],
        })
      )
        .to.eventually.be.rejectedWith('blocked')
    })
    it('rejections are UrlPolicyDeniedError with info.status 403 (→ HTTP 403)', async () => {
      const { assertUrlAllowed } = UrlPolicy
      let err = null
      try {
        await assertUrlAllowed('https://evil.org/x', {
          allowedResourcesRegex: '.*\\.uni-bremen\\.de/.*',
          blockedNetworks: [],
        })
      } catch (e) {
        err = e
      }
      expect(err, 'allowlist mismatch throws').to.be.instanceOf(
        LinkedFilesErrors.UrlPolicyDeniedError
      )
      expect(err.info.status).to.equal(403)
      err = null
      try {
        await assertUrlAllowed('http://127.0.0.1:3000/x', {
          allowedResourcesRegex: '',
          blockedNetworks: ['127.0.0.0/8'],
        })
      } catch (e) {
        err = e
      }
      expect(err, 'blocked network throws').to.be.instanceOf(
        LinkedFilesErrors.UrlPolicyDeniedError
      )
      expect(err.info.status).to.equal(403)
    })
  })
})
