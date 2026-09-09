import { beforeEach, describe, expect, it, vi } from 'vitest'

let alertChecker
let sendEmailStub
let updateOneStub
let ctx

describe('instance-stats alertChecker', function () {
  beforeEach(async function () {
    vi.resetModules()

    ctx = {
      configDocument: null,
      statDocs: [],
    }
    sendEmailStub = vi.fn(async () => ({ ack: true }))
    updateOneStub = vi.fn(async () => ({ acknowledged: true }))

    vi.doMock('@overleaf/logger', () => ({
      default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    }))
    vi.doMock('@overleaf/settings', () => ({ default: {} }))
    vi.doMock(
      '../../../../../app/src/Features/Email/EmailSender.mjs',
      () => ({ default: { promises: { sendEmail: sendEmailStub } } })
    )
    vi.doMock('../../../../../app/src/models/InstanceStat.mjs', () => ({
      get InstanceStat() {
        return {
          findOne: () => ({
            sort: () => ({
              lean: async () => ctx.statDocs.shift() ?? null,
            }),
          }),
        }
      },
    }))
    vi.doMock(
      '../../../app/src/models/InstanceStatAlertConfig.mjs',
      () => ({
        get InstanceStatAlertConfig() {
          return {
            findOne: () => ({
              lean: async () => ctx.configDocument,
            }),
            updateOne: updateOneStub,
          }
        },
        ALERT_CONFIG_ID: 'instance-stats',
      })
    )

    alertChecker = await import('../../../app/src/alertChecker.mjs')
  })

  describe('evaluateAlerts', function () {
    it('returns no alerts when the config is null', function () {
      expect(
        alertChecker.evaluateAlerts(
          [9 * 1024 ** 3, 100 * 1024 ** 3],
          [1 * 1024 ** 3, 99 * 1024 ** 3],
          null
        )
      ).toEqual([])
    })

    it('returns no alerts when alertEmail is empty', function () {
      expect(
        alertChecker.evaluateAlerts(
          [9 * 1024 ** 3, 100 * 1024 ** 3],
          [1 * 1024 ** 3, 99 * 1024 ** 3],
          { alertEmail: '' }
        )
      ).toEqual([])
    })

    it('fires a disk alert when used disk is above the threshold', function () {
      const alerts = alertChecker.evaluateAlerts(
        [9 * 1024 ** 3, 100 * 1024 ** 3],
        null,
        { alertEmail: 'a@b.co', diskWarningPercent: 90 }
      )
      expect(alerts).toHaveLength(1)
      expect(alerts[0].statKey).toBe('disk_usage')
      expect(alerts[0].percentUsed).toBe(91)
    })

    it('does not fire a disk alert below the threshold', function () {
      expect(
        alertChecker.evaluateAlerts(
          [99 * 1024 ** 3, 100 * 1024 ** 3],
          null,
          { alertEmail: 'a@b.co', diskWarningPercent: 90 }
        )
      ).toEqual([])
    })

    it('does not fire a disk alert when total is zero', function () {
      expect(
        alertChecker.evaluateAlerts(
          [0, 0],
          null,
          { alertEmail: 'a@b.co', diskWarningPercent: 90 }
        )
      ).toEqual([])
    })

    it('fires a RAM alert when used RAM is above the threshold', function () {
      const alerts = alertChecker.evaluateAlerts(
        null,
        [1 * 1024 ** 3, 99 * 1024 ** 3],
        { alertEmail: 'a@b.co', ramWarningPercent: 90 }
      )
      expect(alerts).toHaveLength(1)
      expect(alerts[0].statKey).toBe('ram_usage')
      expect(alerts[0].percentUsed).toBe(99)
    })

    it('throttles each metric to at most one alert per 24h', function () {
      const now = Date.now()
      const alerts = alertChecker.evaluateAlerts(
        [9 * 1024 ** 3, 100 * 1024 ** 3],
        [1 * 1024 ** 3, 99 * 1024 ** 3],
        {
          alertEmail: 'a@b.co',
          diskWarningPercent: 90,
          ramWarningPercent: 90,
          lastDiskAlertAt: new Date(now - 60 * 60 * 1000),
          lastRamAlertAt: new Date(now - 60 * 60 * 1000),
        },
        now
      )
      expect(alerts).toEqual([])
    })
  })

  describe('runThresholdChecks', function () {
    it('returns no alerts and does not email when no config exists', async function () {
      const result = await alertChecker.runThresholdChecks()
      expect(result).toEqual([])
      expect(sendEmailStub).not.toHaveBeenCalled()
    })

    it('sends one email per firing metric and records the alert times', async function () {
      ctx.configDocument = {
        alertEmail: 'a@b.co',
        diskWarningPercent: 90,
        ramWarningPercent: 90,
      }
      ctx.statDocs = [
        { statKey: 'disk_usage', values: [9 * 1024 ** 3, 100 * 1024 ** 3] },
        { statKey: 'ram_usage', values: [1 * 1024 ** 3, 99 * 1024 ** 3] },
      ]

      const result = await alertChecker.runThresholdChecks()

      expect(result.map(a => a.statKey).sort()).toEqual([
        'disk_usage',
        'ram_usage',
      ])
      expect(sendEmailStub).toHaveBeenCalledTimes(2)
      expect(updateOneStub).toHaveBeenCalled()
    })

    it('does not record alert times for metrics that did not fire', async function () {
      ctx.configDocument = {
        alertEmail: 'a@b.co',
        diskWarningPercent: 90,
        ramWarningPercent: 90,
      }
      ctx.statDocs = [
        { statKey: 'disk_usage', values: [99 * 1024 ** 3, 100 * 1024 ** 3] },
        { statKey: 'ram_usage', values: [99 * 1024 ** 3, 1 * 1024 ** 3] },
      ]

      const result = await alertChecker.runThresholdChecks()

      expect(result).toEqual([])
      expect(updateOneStub).not.toHaveBeenCalled()
    })
  })
})
