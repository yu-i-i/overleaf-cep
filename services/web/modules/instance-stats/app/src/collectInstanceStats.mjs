import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'
import RedisWrapper from '../../../../app/src/infrastructure/RedisWrapper.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Role string stored inside User.adminRoles (array of strings). */
const GUEST_ADMIN_ROLE = 'guest-user'

/** Mongo filter: user is a guest if their adminRoles list includes this role. */
function guestUserFilter() {
  return { adminRoles: { $in: [GUEST_ADMIN_ROLE] } }
}

function isUserSegmentationEnabled() {
  return Boolean(Settings.instanceStats?.userSegmentation?.enabled)
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
    const { stdout } = await execFileAsync('du', ['-b0s', path])
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
  const segmentationEnabled = isUserSegmentationEnabled()

  const projects = db.collection('projects')
  const users = db.collection('users')
  const docs = db.collection('docs')

  const activeProjects = await projects.countDocuments({
    lastUpdated: { $gte: oneDayAgo },
  })

  let activeUsersValues
  let userCountValues

  if (segmentationEnabled) {
    const guestMatch = guestUserFilter()

    const activeGuestUsers = await users.countDocuments({
      ...guestMatch,
      lastActive: { $gte: oneDayAgo },
    })
    const activeUsersTotal = await users.countDocuments({
      lastActive: { $gte: oneDayAgo },
    })
    const activeStandardUsers = activeUsersTotal - activeGuestUsers

    const guestUsers = await users.countDocuments(guestMatch)
    const totalUsers = await users.countDocuments()
    const standardUsers = totalUsers - guestUsers

    // [standard, guest] — matches chart labels in instance-stats frontend config
    activeUsersValues = [activeStandardUsers, activeGuestUsers]
    userCountValues = [standardUsers, guestUsers]
  } else {
    const activeUsers = await users.countDocuments({
      lastActive: { $gte: oneDayAgo },
    })
    const totalUsers = await users.countDocuments()

    activeUsersValues = [activeUsers]
    userCountValues = [totalUsers]
  }

  const projectCount = await projects.countDocuments()
  const fileCount = await docs.countDocuments()

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
  await upsertStat({ statKey: 'project_count', day, values: [projectCount], generatedAt })
  await upsertStat({ statKey: 'file_count', day, values: [fileCount], generatedAt })
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

