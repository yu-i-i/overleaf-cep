import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import EmailSender from '../../../../app/src/Features/Email/EmailSender.mjs'
import Settings from '@overleaf/settings'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'

import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import {
  InstanceStatAlertConfig,
  ALERT_CONFIG_ID,
} from './models/InstanceStatAlertConfig.mjs'
import {
  STAT_KEYS,
  WINDOWS,
  computeCutoff,
} from './instanceStatsConstants.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

function validateWindow(window) {
  if (window === 'all') return true
  return Object.hasOwn(WINDOWS, window)
}

async function page(req, res, next) {
  try {
    // N-2 round 3 (2026-09-01): the page now extends the golden
    // layout-react skeleton; the shared chrome reads its theme from the
    // ol-userSettings meta (same local as the page-shells controllers).
    let userSettings = {}
    if (req?.user) {
      const user = (await User.findById(req.user._id, 'ace')) ?? req.user
      userSettings = await UserSettingsHelper.buildUserSettings(
        req,
        res,
        user,
      )
    }
    res.render(
      Path.resolve(__dirname, '../views/instance-stats'),
      {
        title: 'Instance Statistics',
        initialWindow: 'month',
        userSettings,
      },
    )
  } catch (err) {
    next(err)
  }
}

const EMAIL_RE = /^[^\s]+@[^\s]+\.[^\s]+$/

// 2026-09-01 (user feedback 3B): multiple alert recipients. Accepts the
// new `alertEmails` string[] as well as the legacy `alertEmail` string.
function normalizeEmails(body) {
  let raw = []
  if (Array.isArray(body?.alertEmails)) {
    raw = body.alertEmails.filter(x => typeof x === 'string')
  } else if (typeof body?.alertEmails === 'string') {
    raw = body.alertEmails.split(/[\s,;]+/)
  } else if (typeof body?.alertEmail === 'string') {
    raw = body.alertEmail.split(/[\s,;]+/)
  }
  const emails = [...new Set(
    raw.map(s => s.trim()).filter(s => s !== '')
  )]
  for (const email of emails) {
    if (!EMAIL_RE.test(email)) {
      return { error: `Invalid email address: ${email}` }
    }
  }
  return { emails }
}

function parseAlertConfigBody(body) {
  const normalized = normalizeEmails(body)
  if (normalized.error) {
    return { error: normalized.error }
  }
  const emails = normalized.emails
  const diskWarningPercent = body?.diskWarningPercent
  const ramWarningPercent = body?.ramWarningPercent

  for (const [key, value] of Object.entries({
    diskWarningPercent,
    ramWarningPercent,
  })) {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 1 ||
      value > 100
    ) {
      return { error: `${key} must be a number between 1 and 100` }
    }
  }
  return {
    alertEmails: emails,
    // Keep the legacy field in sync for old readers.
    alertEmail: emails[0] ?? '',
    diskWarningPercent,
    ramWarningPercent,
  }
}

function configEmails(config) {
  const list = Array.isArray(config?.alertEmails)
    ? config.alertEmails.filter(e => typeof e === 'string' && e !== '')
    : []
  if (!list.length && typeof config?.alertEmail === 'string' && config.alertEmail) {
    list.push(config.alertEmail)
  }
  return list
}

async function getAlertConfig(req, res, next) {
  try {
    const config = await InstanceStatAlertConfig.findOne({
      _id: ALERT_CONFIG_ID,
    }).lean()
    return res.status(200).json({
      alertEmails: configEmails(config),
      alertEmail: (configEmails(config))[0] ?? '',
      diskWarningPercent: config?.diskWarningPercent ?? 90,
      ramWarningPercent: config?.ramWarningPercent ?? 90,
    })
  } catch (err) {
    logger.error({ err }, 'Failed to get instance stats alert config')
    next(err)
  }
}

async function saveAlertConfig(req, res, next) {
  try {
    const parsed = parseAlertConfigBody(req.body)
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error })
    }
    await InstanceStatAlertConfig.updateOne(
      { _id: ALERT_CONFIG_ID },
      { $set: parsed },
      { upsert: true }
    )
    return res.status(200).json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'Failed to save instance stats alert config')
    next(err)
  }
}

async function sendTestAlertEmail(req, res, next) {
  try {
    const normalized = normalizeEmails({
      alertEmails:
        typeof req.body?.emails === 'string'
          ? req.body.emails.split(/[\s,;]+/)
          : req.body?.emails,
      alertEmail: req.body?.email,
    })
    if (normalized.error) {
      return res.status(400).json({ message: normalized.error })
    }
    if (!normalized.emails.length) {
      return res.status(400).json({ message: 'Invalid email address' })
    }
    for (const to of normalized.emails) {
      await EmailSender.promises.sendEmail(
        {
          to,
          subject: '[Overleaf] Instance stats alert test',
          html: '<p>This is a test email from the Instance Statistics alert configuration.</p>',
          text: 'This is a test email from the Instance Statistics alert configuration.',
        },
        'instance_stats_test'
      )
    }
    return res.status(200).json({ ok: true, sentTo: normalized.emails })
  } catch (err) {
    logger.error({ err }, 'Failed to send test alert email')
    next(err)
  }
}

async function series(req, res, next) {
  const metric = req.query.metric
  const window = req.query.window || 'month'

  try {
    if (typeof metric !== 'string' || !STAT_KEYS.includes(metric)) {
      return res.status(400).json({ message: 'Invalid metric' })
    }

    if (typeof window !== 'string' || !validateWindow(window)) {
      return res.status(400).json({ message: 'Invalid window' })
    }

    const retentionDays = Settings.instanceStats?.retentionDays || 365
    const now = new Date()

    const cutoffDate = computeCutoff(window, now, retentionDays)

    const docs = await InstanceStat.find(
      { statKey: metric, day: { $gte: cutoffDate } },
      { _id: 0, day: 1, values: 1 }
    )
      .sort({ day: 1 })
      .lean()

    return res.status(200).json({
      metric,
      window,
      points: docs.map(d => ({
        day: d.day.getTime(),
        values: d.values,
      })),
    })
  } catch (err) {
    logger.error({ err, metric, window }, 'Failed to fetch instance stats series')
    next(err)
  }
}

export default {
  page,
  series,
  getAlertConfig,
  saveAlertConfig,
  sendTestAlertEmail,
}

