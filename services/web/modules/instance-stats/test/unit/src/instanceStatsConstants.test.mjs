import { describe, expect, it } from 'vitest'
import {
  STAT_KEYS,
  WINDOWS,
  SERIES_COUNTS,
  toUtcMidnight,
  computeCutoff,
  DAY_MS,
} from '../../../app/src/instanceStatsConstants.mjs'

describe('instanceStatsConstants', function () {
  describe('STAT_KEYS', function () {
    it('includes only single-stat names', function () {
      expect(STAT_KEYS.length).toBeGreaterThanOrEqual(10)
      for (const key of STAT_KEYS) {
        expect(typeof key).toBe('string')
      }
    })

    it('has a matching SERIES_COUNTS entry for every stat key', function () {
      for (const key of STAT_KEYS) {
        expect(SERIES_COUNTS[key]).toBeGreaterThan(0)
      }
    })

    it('does not include guest segmentation keys (removal guard)', function () {
      expect(STAT_KEYS).not.toContain('active_users_segmented')
      expect(STAT_KEYS).not.toContain('guest_users')
    })
  })

  describe('toUtcMidnight', function () {
    it('returns 00:00 UTC for a mid-day date', function () {
      const d = new Date('2024-06-15T14:30:00Z')
      const result = toUtcMidnight(d)
      expect(result.getUTCHours()).toBe(0)
      expect(result.getUTCMinutes()).toBe(0)
      expect(result.getUTCSeconds()).toBe(0)
      expect(result.getUTCDate()).toBe(15)
      expect(result.getUTCMonth()).toBe(5)
    })

    it('is idempotent for dates already at midnight', function () {
      const d = new Date(Date.UTC(2024, 0, 1))
      expect(toUtcMidnight(d).getTime()).toBe(d.getTime())
    })
  })

  describe('computeCutoff', function () {
    const now = new Date(Date.UTC(2024, 2, 15, 12, 0, 0))

    it('uses WINDOWS values for named windows', function () {
      const monthCutoff = computeCutoff('month', now, 365)
      expect(now.getTime() - monthCutoff.getTime()).toBeLessThan(
        31 * DAY_MS
      )
      expect(monthCutoff.getTime()).toBeLessThan(now.getTime())
    })

    it('uses retentionDays for the window=all window', function () {
      const allCutoff = computeCutoff('all', now, 365)
      // The cutoff is floored to UTC midnight (daily stat buckets), so the
      // span from `now` is within [retentionDays, retentionDays + 1 day).
      const delta = now.getTime() - allCutoff.getTime()
      expect(delta).toBeGreaterThanOrEqual(365 * DAY_MS)
      expect(delta).toBeLessThan(366 * DAY_MS)
    })

    it('fallbacks to 30 days for unknown windows', function () {
      const cutoff = computeCutoff('unknown-window', now, 365)
      expect(
        now.getTime() - cutoff.getTime()
      ).toBeLessThan(31 * DAY_MS)
    })
  })

  describe('WINDOWS', function () {
    it('has the expected month/6m/year values', function () {
      expect(WINDOWS.month).toBe(30)
      expect(WINDOWS['6m']).toBe(180)
      expect(WINDOWS.year).toBe(365)
    })
  })
})
