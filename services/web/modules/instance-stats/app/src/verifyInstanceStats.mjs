import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'

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

function computeCutoff(window) {
  const retentionDays = Settings.instanceStats?.retentionDays || 365
  const now = new Date()
  const cutoffDays = window === 'all' ? retentionDays : WINDOWS[window] || 30
  return toUtcMidnight(new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000))
}

async function main() {
  await mongoose.connectionPromise
  const segmentationEnabled =
    Settings.instanceStats?.userSegmentation?.enabled &&
    Boolean(Settings.instanceStats?.userSegmentation?.internalDomain)

  const statKeys = [
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

  const windowsToCheck = ['month', '6m', 'year', 'all']

  for (const statKey of statKeys) {
    for (const window of windowsToCheck) {
      const cutoff = computeCutoff(window)
      const docs = await InstanceStat.find(
        { statKey, day: { $gte: cutoff } },
        { _id: 0, values: 1 }
      )
        .sort({ day: 1 })
        .limit(10)
        .lean()

      if (docs.length === 0) {
        logger.warn({ statKey, window }, 'No points in window (may be expected initially)')
        continue
      }

      const expectTwo =
        statKey === 'redis_storage' ||
        (segmentationEnabled &&
          (statKey === 'active_users' ||
            statKey === 'user_count' ||
            statKey === 'collaborators'))
      for (const [i, d] of docs.entries()) {
        const len = d.values?.length || 0
        if (expectTwo && len < 2) {
          throw new Error(
            `${statKey} expected 2-series values, but got len=${len} (example index ${i}, window=${window})`
          )
        }
        if (!expectTwo && len < 1) {
          throw new Error(
            `${statKey} expected 1-series values, but got len=${len} (example index ${i}, window=${window})`
          )
        }
      }
    }
  }

  logger.info('Instance stats verification completed')
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.err({ err }, 'Instance stats verification failed')
    process.exit(1)
  })

