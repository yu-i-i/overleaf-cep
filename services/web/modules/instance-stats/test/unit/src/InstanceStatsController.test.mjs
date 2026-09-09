import { beforeEach, describe, expect, it, vi } from 'vitest'
import MockResponse from '../../../../../test/unit/src/helpers/MockResponse.mjs'

let ctx

describe('instance-stats InstanceStatsController', function () {
  beforeEach(async function () {
    vi.resetModules()

    ctx = {
      res: new MockResponse(vi),
      alertConfigDoc: null,
      updateOneCalls: [],
      sendEmailArgs: [],
      failSendEmail: false,
    }

    vi.doMock('@overleaf/logger', () => ({
      default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    }))
    vi.doMock('@overleaf/settings', () => ({
      default: { instanceStats: { enabled: true, retentionDays: 365 } },
    }))
    vi.doMock(
      '../../../../../app/src/Features/Email/EmailSender.mjs',
      () => ({
        default: {
          promises: {
            sendEmail: vi.fn(async (...args) => {
              if (ctx.failSendEmail) throw new Error('smtp down')
              ctx.sendEmailArgs.push(args)
              return { ack: true }
            }),
          },
        },
      })
    )
    vi.doMock(
      '../../../app/src/models/InstanceStatAlertConfig.mjs',
      () => ({
        InstanceStatAlertConfig: {
          findOne: () => ({
            lean: async () => ctx.alertConfigDoc,
          }),
          updateOne: vi.fn(async (filter, updates, options) => {
            ctx.updateOneCalls.push({ filter, updates, options })
            return { acknowledged: true }
          }),
        },
        ALERT_CONFIG_ID: 'instance-stats',
      })
    )
    vi.doMock('../../../../../app/src/models/InstanceStat.mjs', () => ({
      InstanceStat: {
        find: () => ({
          sort: () => ({
            limit: () => ({
              lean: async () => [],
            }),
          }),
        }),
      },
    }))
    // page() (round-3 golden rebuild) imports the real User model +
    // UserSettingsHelper to build userSettings. Mock both so this suite
    // never pulls the real Mongoose stack (its import runs
    // mongoose.connect(Settings.mongo.url) and this mocked Settings has no
    // .mongo). page() itself is not exercised by these alert tests.
    vi.doMock('../../../../../app/src/models/User.mjs', () => ({
      User: {
        findById: async () => null,
      },
    }))
    vi.doMock(
      '../../../../../app/src/Features/Project/UserSettingsHelper.mjs',
      () => ({
        default: {
          buildUserSettings: async () => ({}),
        },
      })
    )

    ctx.Controller = (await import(
      '../../../app/src/InstanceStatsController.mjs'
    )).default
  })

  describe('getAlertConfig', function () {
    it('returns defaults when the config doc does not exist', async function () {
      const req = { query: {}, params: {} }
      await ctx.Controller.getAlertConfig(req, ctx.res, () => {})
      expect(ctx.res.statusCode).toBe(200)
      const body = JSON.parse(ctx.res.body)
      expect(body.alertEmail).toBe('')
      expect(body.diskWarningPercent).toBe(90)
      expect(body.ramWarningPercent).toBe(90)
    })

    it('returns the stored config when it exists', async function () {
      ctx.alertConfigDoc = {
        _id: 'instance-stats',
        alertEmail: 'admin@example.com',
        diskWarningPercent: 85,
        ramWarningPercent: 75,
      }
      const req = { query: {}, params: {} }
      await ctx.Controller.getAlertConfig(req, ctx.res, () => {})
      const body = JSON.parse(ctx.res.body)
      expect(body.alertEmail).toBe('admin@example.com')
      expect(body.diskWarningPercent).toBe(85)
      expect(body.ramWarningPercent).toBe(75)
    })
  })

  describe('saveAlertConfig', function () {
    it('saves valid config values with upsert', async function () {
      const req = {
        body: {
          alertEmail: 'admin@example.com',
          diskWarningPercent: 90,
          ramWarningPercent: 80,
        },
      }
      await ctx.Controller.saveAlertConfig(req, ctx.res, () => {})
      expect(ctx.res.statusCode).toBe(200)
      expect(ctx.updateOneCalls).toHaveLength(1)
      const { filter, updates, options } = ctx.updateOneCalls[0]
      expect(filter).toEqual({ _id: 'instance-stats' })
      expect(options.upsert).toBe(true)
      expect(updates.$set).toEqual({
        alertEmails: ['admin@example.com'],
        alertEmail: 'admin@example.com',
        diskWarningPercent: 90,
        ramWarningPercent: 80,
      })
    })

    it('saves multiple alert recipients (2026-09-01 feedback 3B)', async function () {
      const req = {
        body: {
          alertEmails: ['admin@example.com', 'ops@example.com'],
          diskWarningPercent: 90,
          ramWarningPercent: 80,
        },
      }
      await ctx.Controller.saveAlertConfig(req, ctx.res, () => {})
      expect(ctx.res.statusCode).toBe(200)
      const { updates } = ctx.updateOneCalls[0]
      expect(updates.$set.alertEmails).toEqual([
        'admin@example.com',
        'ops@example.com',
      ])
      expect(updates.$set.alertEmail).toBe('admin@example.com')
    })

    it('rejects an invalid email address', async function () {
      const req = {
        body: {
          alertEmail: 'not-an-email',
          diskWarningPercent: 90,
          ramWarningPercent: 80,
        },
      }
      await ctx.Controller.saveAlertConfig(req, ctx.res, () => {})
      expect(JSON.parse(ctx.res.body)).toEqual({
        message: 'Invalid email address: not-an-email',
      })
      expect(ctx.updateOneCalls).toHaveLength(0)
    })

    it('allows an empty email (alerts disabled) to be saved', async function () {
      const req = {
        body: {
          alertEmail: '',
          diskWarningPercent: 90,
          ramWarningPercent: 80,
        },
      }
      await ctx.Controller.saveAlertConfig(req, ctx.res, () => {})
      expect(ctx.res.statusCode).toBe(200)
      expect(ctx.updateOneCalls).toHaveLength(1)
    })

    it('rejects out-of-range thresholds', async function () {
      const req = {
        body: {
          alertEmail: '',
          diskWarningPercent: 101,
          ramWarningPercent: 80,
        },
      }
      await ctx.Controller.saveAlertConfig(req, ctx.res, () => {})
      expect(
        JSON.parse(ctx.res.body).message
      ).toContain('diskWarningPercent')
      expect(ctx.updateOneCalls).toHaveLength(0)
    })
  })

  describe('sendTestAlertEmail', function () {
    it('rejects an invalid email', async function () {
      const req = { body: { email: 'nope' } }
      await ctx.Controller.sendTestAlertEmail(req, ctx.res, () => {})
      expect(JSON.parse(ctx.res.body)).toEqual({
        message: 'Invalid email address: nope',
      })
      expect(ctx.sendEmailArgs).toHaveLength(0)
    })

    it('sends the test email to EVERY listed recipient (feedback 3B)', async function () {
      const req = {
        body: { emails: ['admin@example.com', 'ops@example.com'] },
      }
      await ctx.Controller.sendTestAlertEmail(req, ctx.res, () => {})
      expect(ctx.sendEmailArgs).toHaveLength(2)
      expect(ctx.sendEmailArgs.map(a => a[0].to)).toEqual([
        'admin@example.com',
        'ops@example.com',
      ])
      expect(JSON.parse(ctx.res.body).sentTo).toEqual([
        'admin@example.com',
        'ops@example.com',
      ])
    })

    it('sends the test email and returns ok', async function () {
      const req = { body: { email: 'admin@example.com' } }
      await ctx.Controller.sendTestAlertEmail(req, ctx.res, () => {})
      expect(JSON.parse(ctx.res.body)).toEqual({
        ok: true,
        sentTo: ['admin@example.com'],
      })
      expect(ctx.sendEmailArgs).toHaveLength(1)
      expect(ctx.sendEmailArgs[0][0].to).toBe('admin@example.com')
    })

    it('propagates a send failure through next(err)', async function () {
      ctx.failSendEmail = true
      const req = { body: { email: 'admin@example.com' } }
      const next = vi.fn()
      await ctx.Controller.sendTestAlertEmail(req, ctx.res, next)
      expect(next).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})
