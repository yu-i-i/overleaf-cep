import fs from 'node:fs/promises'
import Path from 'node:path'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'

const FILE_TO_STAT_KEY = {
  active_projects: 'active_projects',
  active_users: 'active_users',
  user_count: 'user_count',
  project_count: 'project_count',
  file_count: 'file_count',
  mongodb_storage: 'mongodb_storage',
  overleaf_storage: 'overleaf_storage',
  redis_storage: 'redis_storage',
}

function parseDay(dayStr) {
  // Interpret YYYY-MM-DD as UTC midnight.
  const [year, month, day] = dayStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function parseLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/)
  const dayStr = parts[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return null
  const values = parts.slice(1).map(v => Number(v)).filter(v => Number.isFinite(v))
  if (values.length === 0) return null
  return { day: parseDay(dayStr), values }
}

async function chunkedBulkWrite(operations, batchSize) {
  for (let i = 0; i < operations.length; i += batchSize) {
    const slice = operations.slice(i, i + batchSize)
    if (slice.length === 0) continue
    await InstanceStat.bulkWrite(slice, { ordered: false })
  }
}

async function backfillFromDir(inputDir) {
  const generatedAt = new Date()

  for (const [fileBase, statKey] of Object.entries(FILE_TO_STAT_KEY)) {
    const filePath = Path.join(inputDir, `${fileBase}.txt`)
    let content
    try {
      content = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      logger.warn({ filePath, err }, 'Skipping missing stats file')
      continue
    }

    const operations = []
    for (const line of content.split('\n')) {
      const parsed = parseLine(line)
      if (!parsed) continue
      operations.push({
        updateOne: {
          filter: { statKey, day: parsed.day },
          update: { $set: { values: parsed.values, generatedAt } },
          upsert: true,
        },
      })
    }

    logger.info(
      { statKey, count: operations.length },
      'Backfilling instance stats'
    )
    await chunkedBulkWrite(operations, 1000)
  }
}

async function main() {
  if (!Settings.instanceStats?.enabled) {
    logger.info({ enabled: false }, 'Instance stats disabled; still allowing backfill script to run')
  }

  const inputDir = process.env.INSTANCE_STATS_BACKFILL_DIR
  if (!inputDir) {
    throw new Error('Missing INSTANCE_STATS_BACKFILL_DIR')
  }

  await mongoose.connectionPromise

  const absDir = Path.resolve(inputDir)
  logger.info({ absDir }, 'Starting instance stats backfill')
  await backfillFromDir(absDir)
  logger.info({ absDir }, 'Completed instance stats backfill')
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.err({ err }, 'Instance stats backfill failed')
    process.exit(1)
  })

