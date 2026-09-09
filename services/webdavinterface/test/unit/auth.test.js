import { describe, it, expect } from 'vitest'
import {
  generateBasicAuthHeader,
  validateAuth,
  sanitizeUrlForLogging
} from '../../app/src/auth.mjs'

describe('auth', () => {
  it('generateBasicAuthHeader encodes credentials correctly', () => {
    const header = generateBasicAuthHeader('user', 'pass')
    expect(header).toBe('Basic dXNlcjpwYXNz')
  })

  it('validateAuth accepts valid auth', () => {
    expect(() => validateAuth({ username: 'user', password: 'pass' }))
      .not.toThrow()
  })

  it('validateAuth rejects missing username', () => {
    expect(() => validateAuth({ password: 'pass' }))
      .toThrow('Missing authentication credentials')
  })

  it('validateAuth rejects missing password', () => {
    expect(() => validateAuth({ username: 'user' }))
      .toThrow('Missing authentication credentials')
  })

  it('sanitizeUrlForLogging removes credentials from URL', () => {
    const result = sanitizeUrlForLogging('http://user:pass@example.com/path')
    expect(result).toBe('http://example.com/path')
  })
})
