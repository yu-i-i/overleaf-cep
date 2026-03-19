import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const STAT_KEYS = [
  'active_projects',
  'active_users',
  'user_count',
  'collaborators',
  'project_count',
  'file_count',
  'history_blobs',
  'mongodb_storage',
  'overleaf_storage',
  'redis_storage',
]

const WINDOWS = {
  month: 30,
  '6m': 180,
  year: 365,
}

function toUtcMidnight(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

function validateWindow(window) {
  if (window === 'all') return true
  return Object.hasOwn(WINDOWS, window)
}

async function page(req, res, next) {
  try {
    res.render(Path.resolve(__dirname, '../views/instance-stats'), {
      title: 'Instance Statistics',
      initialWindow: 'month',
    })
  } catch (err) {
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
    const cutoffDays = window === 'all' ? retentionDays : WINDOWS[window]

    const cutoffDate = toUtcMidnight(
      new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000)
    )

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
}

