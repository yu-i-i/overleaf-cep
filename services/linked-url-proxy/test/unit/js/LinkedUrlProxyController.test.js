import { expect, describe, it, vi } from 'vitest'
import Path from 'node:path'

const modulePath = Path.join(
  import.meta.dirname,
  '../../../app/js/LinkedUrlProxyController.mjs'
)

describe('LinkedUrlProxyController', () => {
  it('should reject external URL imports by default', async () => {
    vi.doMock('@overleaf/settings', () => ({
      default: {
        externalUrlImportEnabled: false,
      },
    }))

    const controller = (await import(modulePath)).default
    const writes = []
    const res = {
      writeHead(status, headers) {
        writes.push({ status, headers })
      },
      end(body) {
        writes.push({ body })
      },
    }

    await controller.proxy(
      { url: '/?url=https://example.com/a.tex', headers: { host: 'localhost' } },
      res
    )

    expect(writes[0]).to.deep.include({ status: 403 })
    expect(writes[1]).to.deep.equal({ body: 'External URL import is disabled' })
  })

  it('should block private and link-local addresses', async () => {
    vi.doMock('@overleaf/settings', () => ({
      default: {
        allowedResources: null,
        blockedNetworks: ['10.0.0.0/8', '169.254.0.0/16', 'fc00::/7'],
      },
    }))

    const { isBlockedIp } = await import(modulePath)

    expect(isBlockedIp('10.1.2.3', 'http://example.com')).to.equal(true)
    expect(isBlockedIp('169.254.169.254', 'http://example.com')).to.equal(true)
    expect(isBlockedIp('fc00::1', 'http://example.com')).to.equal(true)
  })
})
