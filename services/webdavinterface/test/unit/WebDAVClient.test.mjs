import { describe, it, expect } from 'vitest'

describe('WebDAVClient', () => {
  it('validates auth credentials on construction', async () => {
    const WebDAVClient = (await import('../../app/src/WebDAVClient.mjs')).default
    
    await expect(async () => {
      return new WebDAVClient({ 
        baseUrl: 'http://example.com',
        username: '',
        password: 'pass'
      })
    }).rejects.toThrow('Missing authentication credentials')
  })

  it('validates auth with missing username', async () => {
    const WebDAVClient = (await import('../../app/src/WebDAVClient.mjs')).default
    
    await expect(async () => {
      return new WebDAVClient({ 
        baseUrl: 'http://example.com',
        password: 'pass'
      })
    }).rejects.toThrow('Missing authentication credentials')
  })

  it('validates auth with missing password', async () => {
    const WebDAVClient = (await import('../../app/src/WebDAVClient.mjs')).default
    
    await expect(async () => {
      return new WebDAVClient({ 
        baseUrl: 'http://example.com',
        username: 'user'
      })
    }).rejects.toThrow('Missing authentication credentials')
  })

  it('generates correct basic auth header', async () => {
    const { generateBasicAuthHeader } = await import('../../app/src/auth.mjs')
    
    expect(generateBasicAuthHeader('user', 'pass')).toBe('Basic dXNlcjpwYXNz')
  })

  it('keeps the requested directory in listed entry paths', async () => {
    const WebDAVClient = (await import('../../app/src/WebDAVClient.mjs')).default
    const client = new WebDAVClient({
      baseUrl: 'http://example.com',
      username: 'user',
      password: 'pass'
    })
    client.client = {
      getDirectoryContents: async () => [{ basename: 'main.tex', type: 'file' }]
    }

    await expect(client.list('/Overleaf/project')).resolves.toEqual([
      expect.objectContaining({ path: '/Overleaf/project/main.tex' })
    ])
  })

  it('returns binary downloads as base64', async () => {
    const WebDAVClient = (await import('../../app/src/WebDAVClient.mjs')).default
    const client = new WebDAVClient({
      baseUrl: 'http://example.com',
      username: 'user',
      password: 'pass'
    })
    client.client = {
      getFileContents: async () => Buffer.from([0, 255, 1])
    }

    await expect(client.download('/file.bin')).resolves.toBe('AP8B')
  })

  it('ensures a nested parent directory before uploading', async () => {
    const WebDAVClient = (await import('../../app/src/WebDAVClient.mjs')).default
    const client = new WebDAVClient({
      baseUrl: 'http://example.com',
      username: 'user',
      password: 'pass'
    })
    const calls = []
    client.client = {
      createDirectory: async (...args) => calls.push(args),
      putFileContents: async () => undefined
    }

    await client.upload('/Overleaf/project/Bla/file.png', 'AP8B')

    expect(calls).toEqual([
      ['/Overleaf/project/Bla', { recursive: true }]
    ])
  })
})
