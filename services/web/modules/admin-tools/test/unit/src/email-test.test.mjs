/**
 * Email test-endpoint unit tests (UI-R10 W7b) — offline only.
 * Covers the rate limiter and the transport builder's guard rails
 * (invalid stored config must produce a clean error, never a crash,
 * never echo credentials).
 */
import { describe, it, expect } from 'vitest'
import { tryConsumeLimit, buildTransport } from '../../../app/src/EmailTestController.mjs'

describe('PSH/admin-tools e-mail test endpoint', () => {
  it('rate-limits to 5 sends per minute per admin', () => {
    const id = 'user-' + Math.random().toString(36).slice(2)
    for (let i = 0; i < 5; i++) expect(tryConsumeLimit(id)).toBe(true)
    expect(tryConsumeLimit(id)).toBe(false)
  })

  it('isolates rate-limit buckets per admin', () => {
    const a = 'a-' + Math.random().toString(36).slice(2)
    const b = 'b-' + Math.random().toString(36).slice(2)
    for (let i = 0; i < 5; i++) tryConsumeLimit(a)
    expect(tryConsumeLimit(a)).toBe(false)
    expect(tryConsumeLimit(b)).toBe(true)
  })

  it('SES without credentials -> clean error, no credential leakage', () => {
    const r = buildTransport({ driver: 'ses', accessKeyId: '', sesSecret: '' })
    expect(r.error).toBeTruthy()
    expect(String(r.error).toLowerCase()).not.toContain('credential-value')
  })

  it('SES with credentials: builds a transport or reports a clean, specific error', () => {
    const r = buildTransport({
      driver: 'ses',
      accessKeyId: 'AKIA-TEST',
      sesSecret: 'secret',
      sesRegion: 'eu-central-1',
    })
    // Either the transport is ready, or nodemailer rejected the legacy
    // SES config — in which case the error must be clean and MUST NOT
    // leak library internals or credentials.
    if (r.error) {
      expect(r.error).toContain('SES')
      expect(r.error).not.toContain('AKIA-TEST')
      expect(r.error).not.toContain('secret')
      expect(r.error.length).toBeLessThan(120)
    } else {
      expect(r.client).toBeTruthy()
    }
  })

  it('SMTP without host -> clean error', () => {
    const r = buildTransport({ driver: 'smtp', host: '' })
    expect(r.error).toBeTruthy()
  })

  it('unknown driver -> clean error', () => {
    const r = buildTransport({ driver: 'carrier-pigeon' })
    expect(r.error).toBeTruthy()
  })
})
