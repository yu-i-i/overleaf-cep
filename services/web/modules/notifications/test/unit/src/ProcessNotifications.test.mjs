import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const modulePath = path.join(
  import.meta.dirname,
  '../../../app/src/ProcessNotifications.mjs'
)

describe('ProcessNotifications', function () {
  beforeEach(async function (ctx) {
    ctx.emailNotifications = {
      findOneAndUpdate: vi.fn(),
      deleteOne: vi.fn().mockResolvedValue(undefined),
      updateOne: vi.fn().mockResolvedValue(undefined),
    }

    vi.doMock(
      '../../../../../app/src/infrastructure/mongodb.mjs',
      () => ({
        db: {
          emailNotifications: ctx.emailNotifications,
        },
        connectionPromise: Promise.resolve(),
      })
    )

    vi.doMock('@overleaf/logger', () => ({
      default: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    }))

    vi.doMock('@overleaf/settings', () => ({ default: {} }))

    vi.doMock(
      '../../../../../app/src/Features/Email/EmailHandler.mjs',
      () => ({
        default: {
          promises: {
            sendEmail: vi.fn().mockResolvedValue(undefined),
          },
        },
      })
    )

    ctx.ProcessNotifications = await import(modulePath)
  })

  it('should process and delete due scheduled notifications', async function (ctx) {
    const notification = {
      _id: 'notif-1',
      scheduledAt: new Date(Date.now() - 10000),
      emailType: 'testEmail',
      opts: { to: 'user@example.com' },
    }

    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce({ value: notification })
      .mockResolvedValueOnce({ value: null })

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result).toBe(1)
    expect(ctx.emailNotifications.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(ctx.emailNotifications.deleteOne).toHaveBeenCalledWith({ _id: notification._id })
  })

  it('should stop when there are no due notifications', async function (ctx) {
    ctx.emailNotifications.findOneAndUpdate.mockResolvedValue({ value: null })

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result).toBe(0)
    expect(ctx.emailNotifications.deleteOne).not.toHaveBeenCalled()
  })
})
