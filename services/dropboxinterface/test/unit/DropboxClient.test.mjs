import { describe, it, expect } from 'vitest'
import DropboxClient from './app/src/DropboxClient.mjs'

describe('DropboxClient', () => {
  it('validates access token on construction', async () => {
    await expect(async () => {
      return new DropboxClient({ accessToken: '' })
    }).rejects.toThrow('Missing or invalid access token')
  })

  it('validates token format starts with sl.', async () => {
    // Should warn but not reject (for compatibility)
    expect(() => new DropboxClient({ accessToken: 'invalid-token' })).not.toThrow()
  })

  it('isValidToken returns correct boolean', () => {
    expect(DropboxClient.isValidToken('sl.ABC123')).toBe(true)
    expect(DropboxClient.isValidToken('dp.ABC123')).toBe(true)
    expect(DropboxClient.isValidToken('invalid-token')).toBe(false)
    expect(DropboxClient.isValidToken(null)).toBe(false)
  })

  it('sanitizes token for logging', () => {
    // Short tokens are hidden
    const shortResult = DropboxClient.sanitizeTokenForLogging('sl.abc')
    expect(shortResult).toBe('[hidden]')

    // Long tokens show partial info (first 10 + last 4)
    const result = DropboxClient.sanitizeTokenForLogging('sl.' + 'x'.repeat(40))
    // Format: "sl." + 7 chars + "..." + 4 chars = total 17 chars
    expect(result).toBe('sl.xxxxxxx...xxxx')
    expect(result.length).toBe(17)
  })

  it('downloads Node.js fileBinary responses as base64', async () => {
    const client = new DropboxClient({ accessToken: 'sl.test-token' })
    client.dbx.filesDownload = async () => ({
      result: { fileBinary: Buffer.from('downloaded content') },
    })

    await expect(client.download('/test.txt')).resolves.toBe(
      Buffer.from('downloaded content').toString('base64')
    )
  })

  it('list passes through Dropbox content hashes (hash + content_hash) for incremental sync', async () => {
    const client = new DropboxClient({ accessToken: 'sl.test-token' })
    client.dbx.filesListFolder = async () => ({
      result: {
        has_more: false,
        entries: [
          {
            '.tag': 'file',
            name: 'main.tex',
            path_display: '/root/main.tex',
            size: 12,
            rev: 'rev1',
            id: 'id:1',
            hash: 'a'.repeat(64),
            server_modified: '2026-08-19T00:00:00Z',
          },
          {
            '.tag': 'file',
            name: 'newspec.tex',
            path_display: '/root/newspec.tex',
            size: 5,
            rev: 'rev2',
            id: 'id:2',
            content_hash: 'b'.repeat(64),
          },
          { '.tag': 'folder', name: 'sub', path_display: '/root/sub', id: 'id:3' },
        ],
      },
    })
    const res = await client.list('/root', { recursive: false })
    expect(res.entries).toHaveLength(3)
    const [f1, f2, f3] = res.entries
    expect(f1.hash).toBe('a'.repeat(64))
    expect(f1.content_hash).toBeNull()
    expect(f1.path_display in f1 || f1.relative_path).toBeTruthy()
    expect(f2.hash).toBeNull()
    expect(f2.content_hash).toBe('b'.repeat(64))
    expect(f3.type).toBe('folder')
  })

  it('maps a Dropbox path-not-found conflict to 404', () => {
    const client = new DropboxClient({ accessToken: 'sl.test-token' })
    const error = client._mapDropboxError({
      status: 409,
      error: { error: { path: { '.tag': 'not_found' } } },
    })

    expect(error.statusCode).toBe(404)
  })
})
