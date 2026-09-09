import logger from '@overleaf/logger'
import EmailSender from '../../../../app/src/Features/Email/EmailSender.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'
import {
  InstanceStatAlertConfig,
  ALERT_CONFIG_ID,
} from './models/InstanceStatAlertConfig.mjs'

const DAY_MS = 24 * 60 * 60 * 1000

// Alerts are throttled to at most this many per day per metric.
const ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000

export const DEFAULTS = {
  alertEmail: '',
  diskWarningPercent: 90,
  ramWarningPercent: 90,
}

/**
 * Pure function: given the latest disk_usage [availableBytes, totalBytes]
 * and ram_usage [freeBytes, usedBytes] values and the alert config, return
 * the list of alerts that should fire.
 *
 * Exported separately so it can be unit tested without any I/O.
 */
/**
 * Recipients for threshold alerts (2026-09-01 multi-address support):
 * alertEmails[] first, legacy single alertEmail as fallback.
 */
export function recipients(config) {
  const list = Array.isArray(config?.alertEmails)
    ? config.alertEmails.filter(e => typeof e === 'string' && e.trim() !== '')
    : []
  if (!list.length && config?.alertEmail) {
    list.push(config.alertEmail)
  }
  return list
}

export function evaluateAlerts(diskUsage, ramUsage, config, now = Date.now()) {
  if (!config || !recipients(config).length) return []

  const alerts = []

  const total = diskUsage?.[1] ?? 0
  const available = diskUsage?.[0] ?? null
  if (
    total > 0 &&
    available !== null &&
    Math.round(100 - (available / total) * 100) >=
      (config.diskWarningPercent ?? DEFAULTS.diskWarningPercent)
  ) {
    const last = config.lastDiskAlertAt
      ? config.lastDiskAlertAt.getTime()
      : 0
    if (now - last >= ALERT_THROTTLE_MS) {
      alerts.push({
        statKey: 'disk_usage',
        percentUsed: Math.round(100 - (available / total) * 100),
      })
    }
  }

  const free = ramUsage?.[0] ?? null
  const used = ramUsage?.[1] ?? null
  const ramTotal = (free ?? 0) + (used ?? 0)
  if (
    ramTotal > 0 &&
    used !== null &&
    Math.round((used / ramTotal) * 100) >=
      (config.ramWarningPercent ?? DEFAULTS.ramWarningPercent)
  ) {
    const last = config.lastRamAlertAt ? config.lastRamAlertAt.getTime() : 0
    if (now - last >= ALERT_THROTTLE_MS) {
      alerts.push({
        statKey: 'ram_usage',
        percentUsed: Math.round((used / ramTotal) * 100),
      })
    }
  }

  return alerts
}

/** Latest values for both usage metrics from within the last 2 days. */
async function getLatestUsage() {
  const since = new Date(Date.now() - 2 * DAY_MS)
  const [diskDoc, ramDoc] = await Promise.all([
    InstanceStat.findOne({
      statKey: 'disk_usage',
      day: { $gte: since },
    })
      .sort({ day: -1 })
      .lean(),
    InstanceStat.findOne({
      statKey: 'ram_usage',
      day: { $gte: since },
    })
      .sort({ day: -1 })
      .lean(),
  ])
  return {
    diskUsage: diskDoc?.values ?? null,
    ramUsage: ramDoc?.values ?? null,
  }
}

function alertEmailText(alert) {
  const title =
    alert.statKey === 'disk_usage'
      ? `Disk usage is at ${alert.percentUsed}%`
      : `RAM usage is at ${alert.percentUsed}%`
  return `${title} on this Overleaf instance. Check the Instance Statistics admin page for details.`
}

/**
 * Evaluate threshold alerts and send the configured admin email for each
 * firing metric. Non-fatal on every step: called from the hourly collection
 * cron, it must never fail the run.
 */
export async function runThresholdChecks() {
  const config = await InstanceStatAlertConfig.findOne({
    _id: ALERT_CONFIG_ID,
  }).lean()
  const toList = recipients(config)
  if (!toList.length) {
    return []
  }

  const { diskUsage, ramUsage } = await getLatestUsage()
  const alerts = evaluateAlerts(diskUsage, ramUsage, config)

  const updates = {}
  for (const alert of alerts) {
    for (const to of toList) {
      try {
        await EmailSender.promises.sendEmail(
          {
            to,
            subject: `[Overleaf] ${
              alert.statKey === 'disk_usage' ? 'Disk' : 'RAM'
            } usage at ${alert.percentUsed}%`,
            html: `<p>${alertEmailText(alert)}</p>`,
            text: alertEmailText(alert),
          },
          'instance_stats_alert'
        )
        updates[
          alert.statKey === 'disk_usage' ? 'lastDiskAlertAt' : 'lastRamAlertAt'
        ] = new Date()
      } catch (err) {
        logger.error(
          { err, alert },
          'Failed to send instance stats alert email'
        )
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await InstanceStatAlertConfig.updateOne(
      { _id: ALERT_CONFIG_ID },
      { $set: updates }
    )
  }

  return alerts
}

export default { evaluateAlerts, runThresholdChecks, DEFAULTS }
