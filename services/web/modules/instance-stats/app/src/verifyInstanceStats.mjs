import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'
import {
  STAT_KEYS,
  SERIES_COUNTS,
  computeCutoff,
} from './instanceStatsConstants.mjs'

async function main() {
  await mongoose.connectionPromise

  const retentionDays = Settings.instanceStats?.retentionDays ?? 365
  const windowsToCheck = ['month', '6m', 'year', 'all']
  const now = new Date()

  for (const statKey of STAT_KEYS) {
    for (const window of windowsToCheck) {
      const cutoff = computeCutoff(window, now, retentionDays)
      const docs = await InstanceStat.find(
        { statKey, day: { $gte: cutoff } },
        { _id: 0, values: 1 }
      )
        .sort({ day: 1 })
        .limit(10)
        .lean()

      if (docs.length === 0) {
        logger.warn(
          { statKey, window },
          'No points in window (may be expected initially)'
        )
        continue
      }

      const expectTwo = SERIES_COUNTS[statKey] === 2
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
