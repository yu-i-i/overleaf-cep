import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'
import RedisWrapper from '../../../../app/src/infrastructure/RedisWrapper.mjs'
import childProcess from 'node:child_process'

function getInternalUserRegex() {
  const segmentation = Settings.instanceStats?.userSegmentation
  if (!segmentation?.enabled) {
    return null
  }
  const rawDomain = segmentation.internalDomain || ''
  const normalized = rawDomain.trim().replace(/^@/, '').toLowerCase()
  if (!normalized) {
    logger.warn(
      'instanceStats.userSegmentation.enabled=true but INSTANCE_STATS_INTERNAL_DOMAIN is empty; disabling segmentation'
    )
    return null
  }
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`@${escaped}$`, 'i')
}

function toUtcMidnight(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

function parseFirstInt(output) {
  const match = output?.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

async function duBytes(path) {
  // Prefer exact du output in bytes. Fall back to 0 on failure.
  try {
    const { stdout } = await childProcess.promises.execFile('du', [
      '-b0s',
      path,
    ])
    return parseFirstInt(stdout)
  } catch (err) {
    logger.error({ err, path }, 'Failed to compute du bytes')
    return 0
  }
}

function parseRedisInfoInt(info, key) {
  const re = new RegExp(`${key}:(\\\\d+)`)
  const match = info?.match(re)
  return match ? parseInt(match[1], 10) : 0
}

async function getRedisMemoryBytes() {
  const rclient = RedisWrapper.client('instance_stats')
  try {
    // In ioredis, `info(section)` returns a string.
    const info_memory = await rclient.info('memory')
    const usedMemory = parseRedisInfoInt(info_memory, 'used_memory')
    const info_aof = await rclient.info('persistence')
    const usedDisk = parseRedisInfoInt(info_aof, 'aof_current_size')

    return { diskBytes: usedDisk, ramBytes: usedMemory }
  } finally {
    try {
      await rclient.disconnect()
    } catch {}
  }
}

async function upsertStat({ statKey, day, values, generatedAt }) {
  await InstanceStat.updateOne(
    { statKey, day },
    { $set: { values, generatedAt, day } },
    { upsert: true }
  )
}

async function collectForDay({ day }) {
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const db = mongoose.connection.db
  const internalUserRegex = getInternalUserRegex()
  const segmentationEnabled = Boolean(internalUserRegex)

  const projects = db.collection('projects')
  const users = db.collection('users')
  const docs = db.collection('docs')
  const projectHistoryBlobs = db.collection('projectHistoryBlobs')

  const activeProjects = await projects.countDocuments({
    lastUpdated: { $gte: oneDayAgo },
  })

  let activeUsersValues
  let userCountValues
  let collaboratorsValues

  if (segmentationEnabled) {
    const activeInternalUsers = await users.countDocuments({
      email: { $regex: internalUserRegex },
      lastActive: { $gte: oneDayAgo },
    })
    const activeExternalUsers = await users.countDocuments({
      email: { $not: internalUserRegex },
      lastActive: { $gte: oneDayAgo },
    })

    const internalUsers = await users.countDocuments({
      email: { $regex: internalUserRegex },
    })
    const externalUsers = await users.countDocuments({
      email: { $not: internalUserRegex },
    })

    const collaboratorsAgg = await projects
      .aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'collaberator_refs',
            foreignField: '_id',
            as: 'collaboratorDocs',
          },
        },
        { $unwind: '$collaboratorDocs' },
        {
          $group: {
            _id: {
              $cond: [
                {
                  $regexMatch: {
                    input: '$collaboratorDocs.email',
                    regex: internalUserRegex,
                  },
                },
                'internal',
                'external',
              ],
            },
            total: { $sum: 1 },
          },
        },
      ])
      .toArray()

    let collaboratorsInternal = 0
    let collaboratorsExternal = 0
    for (const row of collaboratorsAgg) {
      if (row._id === 'internal') collaboratorsInternal = row.total
      if (row._id === 'external') collaboratorsExternal = row.total
    }

    activeUsersValues = [activeInternalUsers, activeExternalUsers]
    userCountValues = [internalUsers, externalUsers]
    collaboratorsValues = [collaboratorsInternal, collaboratorsExternal]
  } else {
    const activeUsers = await users.countDocuments({
      lastActive: { $gte: oneDayAgo },
    })
    const totalUsers = await users.countDocuments()

    const collaboratorsAgg = await projects
      .aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'collaberator_refs',
            foreignField: '_id',
            as: 'collaboratorDocs',
          },
        },
        { $unwind: '$collaboratorDocs' },
        { $count: 'total' },
      ])
      .toArray()
    const collaboratorsTotal = collaboratorsAgg[0]?.total || 0

    activeUsersValues = [activeUsers]
    userCountValues = [totalUsers]
    collaboratorsValues = [collaboratorsTotal]
  }

  const projectCount = await projects.countDocuments()
  const fileCount = await docs.countDocuments()
  const historyBlobs = await projectHistoryBlobs.countDocuments()

  // Mongo storage: approximate with dbStats.storageSize (bytes).
  let mongodbStorageBytes = 0
  try {
    const stats = await db.admin().command({ dbStats: 1 })
    mongodbStorageBytes =
      stats?.storageSize ?? stats?.dataSize ?? stats?.totalSize ?? 0
  } catch (err) {
    logger.error({ err }, 'Failed to query Mongo dbStats')
  }

  const overleafStorageBytes = await duBytes('/var/lib/overleaf')
  const { diskBytes: redisDiskBytes, ramBytes: redisRamBytes } =
    await getRedisMemoryBytes()

  const generatedAt = new Date()

  await upsertStat({ statKey: 'active_projects', day, values: [activeProjects], generatedAt })
  await upsertStat({ statKey: 'active_users', day, values: activeUsersValues, generatedAt })
  await upsertStat({ statKey: 'user_count', day, values: userCountValues, generatedAt })
  await upsertStat({ statKey: 'collaborators', day, values: collaboratorsValues, generatedAt })
  await upsertStat({ statKey: 'project_count', day, values: [projectCount], generatedAt })
  await upsertStat({ statKey: 'file_count', day, values: [fileCount], generatedAt })
  await upsertStat({ statKey: 'history_blobs', day, values: [historyBlobs], generatedAt })
  await upsertStat({ statKey: 'mongodb_storage', day, values: [mongodbStorageBytes], generatedAt })
  await upsertStat({ statKey: 'overleaf_storage', day, values: [overleafStorageBytes], generatedAt })
  await upsertStat({ statKey: 'redis_storage', day, values: [redisDiskBytes, redisRamBytes], generatedAt })
}

async function main() {
  if (!Settings.instanceStats?.enabled) {
    logger.info({ enabled: false }, 'Instance stats collection disabled')
    return
  }

  await mongoose.connectionPromise

  const now = new Date()
  const day = toUtcMidnight(now)

  logger.info({ day }, 'Collecting instance statistics')
  await collectForDay({ day })
  logger.info({ day }, 'Collected instance statistics')
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.err({ err }, 'Failed collecting instance statistics')
    process.exit(1)
  })

