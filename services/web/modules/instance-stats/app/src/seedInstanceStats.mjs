import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'

const SEGMENTED_STAT_DEFS = {
  active_projects: { base: [30], noise: [12], min: [0] },
  active_users: { base: [120, 80], noise: [25, 20], min: [0, 0] }, // [internal, external]
  user_count: { base: [900, 500], noise: [8, 6], min: [0, 0] }, // [internal, external]
  collaborators: { base: [260, 180], noise: [40, 30], min: [0, 0] }, // [internal, external]
  project_count: { base: [1600], noise: [6], min: [0] },
  file_count: { base: [12000], noise: [80], min: [0] },
  history_blobs: { base: [18000], noise: [120], min: [0] },
  mongodb_storage: { base: [9.5e9], noise: [4.5e7], min: [0] }, // bytes
  overleaf_storage: { base: [2.8e10], noise: [8.0e7], min: [0] }, // bytes
  redis_storage: { base: [4.2e8, 1.9e8], noise: [1.2e7, 7e6], min: [0, 0] }, // bytes
}

function toUtcMidnight(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min
}

function generateValues(def, dayOffset) {
  const season = Math.sin(dayOffset / 14) // gentle periodicity
  return def.base.map((base, i) => {
    const trend = base * (dayOffset * 0.0015)
    const jitter = randomInRange(-def.noise[i], def.noise[i])
    const seasonal = season * def.noise[i] * 0.6
    return Math.max(def.min[i], Math.round(base + trend + jitter + seasonal))
  })
}

function getStatDefsForCurrentSegmentation() {
  const segmentation = Settings.instanceStats?.userSegmentation
  const segmentationEnabled =
    Boolean(segmentation?.enabled) && Boolean(segmentation?.internalDomain)

  if (segmentation?.enabled && !segmentation?.internalDomain) {
    logger.warn(
      'instanceStats.userSegmentation.enabled=true but internalDomain is empty; seeding user metrics as single-series totals'
    )
  }

  if (segmentationEnabled) {
    return SEGMENTED_STAT_DEFS
  }

  return {
    ...SEGMENTED_STAT_DEFS,
    active_users: { base: [200], noise: [35], min: [0] },
    user_count: { base: [1400], noise: [10], min: [0] },
    collaborators: { base: [440], noise: [60], min: [0] },
  }
}

async function main() {
  await mongoose.connectionPromise

  const days = Math.max(parseInt(process.env.INSTANCE_STATS_SEED_DAYS || '400', 10), 1)
  // Default is true so we remove old seeded/real docs unless explicitly disabled.
  const clear = process.env.INSTANCE_STATS_SEED_CLEAR !== 'false'
  const now = new Date()
  const statDefs = getStatDefsForCurrentSegmentation()

  if (clear) {
    logger.info('Clearing existing instanceStats collection before seeding')
    await InstanceStat.deleteMany({})
  }

  const ops = []
  for (let d = days - 1; d >= 0; d--) {
    const day = toUtcMidnight(new Date(now.getTime() - d * 24 * 60 * 60 * 1000))
    for (const [statKey, def] of Object.entries(statDefs)) {
      ops.push({
        updateOne: {
          filter: { statKey, day },
          update: {
            $set: {
              values: generateValues(def, days - d),
              generatedAt: new Date(),
            },
          },
          upsert: true,
        },
      })
    }
  }

  logger.info({ days, docs: ops.length }, 'Seeding fake instance statistics')
  await InstanceStat.bulkWrite(ops, { ordered: false })
  logger.info('Seed completed')
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.err({ err }, 'Failed to seed instance statistics')
    process.exit(1)
  })

