import { describe, it, expect } from 'vitest'
import {
  validateToken,
  sanitizeTokenForLogging,
  extractAccessToken
} from './app/src/auth.mjs'

describe('auth', () => {
  describe('validateToken', () => {
    it('accepts valid sl. token', () => {
      expect(() => validateToken('sl.ABC123')).not.toThrow()
    })

    it('rejects empty token', () => {
      expect(() => validateToken('')).toThrow('Missing or invalid access token')
    })

    it('rejects null token', () => {
      expect(() => validateToken(null)).toThrow('Missing or invalid access token')
    })
  })

  describe('sanitizeTokenForLogging', () => {
    it('hides short tokens', () => {
      expect(sanitizeTokenForLogging('sl.abc')).toBe('[hidden]')
    })

    it('shows partial token for long tokens', () => {
      const result = sanitizeTokenForLogging('sl.' + 'a'.repeat(40))
      // Format: first 10 chars...last 4 chars
      expect(result).toBe('sl.aaaaaaa...aaaa')
      expect(result.length).toBe(17) // "sl." + 7 dots + "..." + 4 chars
    })
  })

  describe('extractAccessToken', () => {
    it('extracts from Authorization header', async () => {
      const req = { headers: { authorization: 'Bearer sl.ABC123' } }
      extractAccessToken(req, null, () => {})
      expect(req.dropboxToken).toBe('sl.ABC123')
    })

    it('extracts from X-Access-Token header', async () => {
      const req = { headers: { 'x-access-token': 'sl.ABC123' } }
      extractAccessToken(req, null, () => {})
      expect(req.dropboxToken).toBe('sl.ABC123')
    })

    it('extracts from body', async () => {
      const req = { headers: {}, body: { access_token: 'sl.ABC123' } }
      extractAccessToken(req, null, () => {})
      expect(req.dropboxToken).toBe('sl.ABC123')
    })

    it('extracts from query params (with warning)', async () => {
      const req = { headers: {}, query: { access_token: 'sl.ABC123' } }
      extractAccessToken(req, null, () => {})
      expect(req.dropboxToken).toBe('sl.ABC123')
    })
  })
})
