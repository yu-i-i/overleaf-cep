import { describe, it, expect } from 'vitest'

describe('WebDAVServiceClient', () => {
  it('constructor accepts credentials with server_url', async () => {
    const path = new URL('../../app/src/WebDAVServiceClient.mjs', import.meta.url)
    const mod = await import(path.pathname)
    
    const client = new mod.WebDAVServiceClient({
      server_url: 'http://example.com',
      username: 'testuser',
      password: 'testpass'
    })
    
    expect(client.baseUrl).toBe('http://example.com')
    expect(client.username).toBe('testuser')
  })

  it('constructor accepts credentials with baseUrl (legacy)', async () => {
    const path = new URL('../../app/src/WebDAVServiceClient.mjs', import.meta.url)
    const mod = await import(path.pathname)
    
    const client = new mod.WebDAVServiceClient({
      baseUrl: 'http://example.com',
      username: 'testuser',
      password: 'testpass'
    })
    
    expect(client.baseUrl).toBe('http://example.com')
  })

  it('removes trailing slash from URL', async () => {
    const path = new URL('../../app/src/WebDAVServiceClient.mjs', import.meta.url)
    const mod = await import(path.pathname)
    
    const client1 = new mod.WebDAVServiceClient({
      server_url: 'http://example.com/',
      username: 'testuser',
      password: 'testpass'
    })
    
    expect(client1.baseUrl).toBe('http://example.com')
  })

  it('builds correct URLs for microservices', async () => {
    const path = new URL('../../app/src/WebDAVServiceClient.mjs', import.meta.url)
    const mod = await import(path.pathname)
    
    process.env.DATAMANIPULATOR_API_URL = 'http://dm.local:4001'
    process.env.WEBDAVINTERFACE_API_URL = 'http://wdi.local:4002'
    
    const client = new mod.WebDAVServiceClient({
      server_url: 'http://webdav.example.com',
      username: 'testuser',
      password: 'testpass'
    })
    
    expect(client.datamanipulatorUrl).toBe('http://dm.local:4001')
    expect(client.webdavInterfaceUrl).toBe('http://wdi.local:4002')
  })

  it('uploads ArrayBuffer content without changing its bytes', async () => {
    const path = new URL('../../app/src/WebDAVServiceClient.mjs', import.meta.url)
    const { WebDAVServiceClient } = await import(path.pathname)
    let requestBody
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return { ok: true, status: 200, text: async () => '' }
    }

    try {
      const client = new WebDAVServiceClient({
        server_url: 'http://example.com',
        username: 'testuser',
        password: 'testpass'
      })
      await client.put('/image.jpg', new Uint8Array([0, 255, 1]).buffer)
      expect(requestBody.content_base64).toBe('AP8B')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
