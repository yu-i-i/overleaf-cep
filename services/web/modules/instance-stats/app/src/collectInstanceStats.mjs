import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { InstanceStat } from '../../../../app/src/models/InstanceStat.mjs'
import RedisWrapper from '../../../../app/src/infrastructure/RedisWrapper.mjs'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { toUtcMidnight, DAY_MS } from './instanceStatsConstants.mjs'

const execFileAsync = promisify(execFile)

async function duBytes(path) {
  // du -b0s reports total size in bytes for a directory tree.
  // Returns 0 on failure (e.g. missing path) so collection continues.
  try {
    const { stdout } = await execFileAsync('du', ['-b0s', path])
    return parseInt(stdout.trim(), 10) || 0
  } catch (err) {
    logger.error({ err, path }, 'Failed to compute du bytes')
    return 0
  }
}

async function diskUsageBytes(path) {
  // df -B1 <path>: "Filesystem 1B-blocks Used Available Capacity Mounted"
  // Returns { totalBytes, availableBytes }, both 0 on failure.
  try {
    const { stdout } = await execFileAsync('df', ['-B1', path])
    const lines = stdout.trim().split('\n')
    const cols = (lines[1] ?? '').trim().split(/\s+/)
    return {
      totalBytes: parseInt(cols[1], 10) || 0,
      availableBytes: parseInt(cols[3], 10) || 0,
    }
  } catch (err) {
    logger.error({ err, path }, 'Failed to compute df usage')
    return { totalBytes: 0, availableBytes: 0 }
  }
}

function parseRedisInfoInt(info, key) {
  const re = new RegExp(`${key}:(\\d+)`)
  const match = info?.match(re)
  return match ? parseInt(match[1], 10) : 0
}

async function getRedisMemoryBytes() {
  // Returns { diskBytes, ramBytes }, zeros on failure (e.g. Redis unreachable
  // or the `instance_stats` feature unconfigured) so the collection run
  // still succeeds for every other metric.
  let rclient
  try {
    rclient = RedisWrapper.client('instance_stats')
  } catch (err) {
    logger.error({ err }, 'Failed to create Redis client for instance stats')
    return { diskBytes: 0, ramBytes: 0 }
  }
  try {
    // In ioredis, `info(section)` returns a string.
    const info_memory = await rclient.info('memory')
    const usedMemory = parseRedisInfoInt(info_memory, 'used_memory')
    const info_aof = await rclient.info('persistence')
    const usedDisk = parseRedisInfoInt(info_aof, 'aof_current_size')

    return { diskBytes: usedDisk, ramBytes: usedMemory }
  } catch (err) {
    logger.error({ err }, 'Failed to query Redis memory usage')
    return { diskBytes: 0, ramBytes: 0 }
  } finally {
    try {
      await rclient?.disconnect()
    } catch {}
  }
}

async function getCpuLoad() {
  // Returns the 1-minute load average from /proc/loadavg, or 0 on failure.
  // (Value equal to the number of CPU cores = fully utilized.)
  try {
    const loadavg = await readFile('/proc/loadavg', { encoding: 'utf8' })
    const parts = loadavg.trim().split(/\s+/)
    return parseFloat(parts[0]) || 0
  } catch (err) {
    logger.error({ err }, 'Failed to read /proc/loadavg')
    return 0
  }
}

async function getRamUsageBytes() {
  // { freeBytes, usedBytes } from /proc/meminfo, zeros on failure.
  try {
    const meminfo = await readFile('/proc/meminfo', { encoding: 'utf8' })
    const totalLine = meminfo.match(/^MemTotal:\s*(\d+)\s*kB/m)
    const freeLine = meminfo.match(/^MemFree:\s*(\d+)\s*kB/m)
    const total = totalLine ? parseInt(totalLine[1], 10) * 1024 : 0
    const free = freeLine ? parseInt(freeLine[1], 10) * 1024 : 0
    return { freeBytes: free, usedBytes: Math.max(total - free, 0) }
  } catch (err) {
    logger.error({ err }, 'Failed to read /proc/meminfo')
    return { freeBytes: 0, usedBytes: 0 }
  }
}

async function upsertStat({ statKey, day, values, generatedAt }) {
  await InstanceStat.updateOne(
    { statKey, day },
    { $set: { values, generatedAt, day } },
    { upsert: true }
  )
}

async function pruneExpired() {
  // Retention: delete docs older than retentionDays so the collection
  // stays bounded (the `window=all` read is bounded by it too).
  const retentionDays = Settings.instanceStats?.retentionDays ?? 365
  const cutoff = toUtcMidnight(
    new Date(Date.now() - (retentionDays + 1) * DAY_MS)
  )
  const result = await InstanceStat.deleteMany({ day: { $lt: cutoff } })
  logger.info(
    { retentionDays, cutoff, deletedCount: result.deletedCount ?? 0 },
    'Pruned expired instance statistics'
  )
}

async function collectForDay({ day }) {
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - DAY_MS)
  const db = mongoose.connection.db

  const projects = db.collection('projects')
  const users = db.collection('users')
  const docs = db.collection('docs')

  const [
    activeProjects,
    projectCount,
    activeUsers,
    totalUsers,
    newUserCount,
    fileCount,
    sharedProjectCount,
  ] = await Promise.all([
    projects.countDocuments({ lastUpdated: { $gte: oneDayAgo } }),
    projects.countDocuments({}),
    users.countDocuments({ lastActive: { $gte: oneDayAgo } }),
    users.countDocuments({}),
    // CE users have signUpDate (the User schema has no top-level createdAt).
    users.countDocuments({ signUpDate: { $gte: oneDayAgo } }),
    docs.countDocuments({}),
    // tokens.readAndWrite is partial-unique-indexed on projects, so this
    // count is cheap.
    projects.countDocuments({ 'tokens.readAndWrite': { $exists: true } }),
  ])

  // Mongo storage: approximate with dbStats.totalSize (bytes).
  // Note that this will be lower that when doing `du` for the mongo
  // data folder, because that includes journaling files that we can not
  // measure directly from mongo.
  let mongodbStorageBytes = 0
  try {
    const stats = await db.stats()
    mongodbStorageBytes = stats?.totalSize ?? 0
  } catch (err) {
    logger.error({ err }, 'Failed to query Mongo dbStats')
  }

  const [duResult, diskResult, cpuLoad, redis, ram] = await Promise.all([
    duBytes('/var/lib/overleaf'),
    diskUsageBytes('/var/lib/overleaf'),
    getCpuLoad(),
    getRedisMemoryBytes(),
    getRamUsageBytes(),
  ])

  const generatedAt = new Date()

  const stats = [
    { statKey: 'active_projects', values: [activeProjects] },
    { statKey: 'active_users', values: [activeUsers] },
    { statKey: 'new_users', values: [newUserCount] },
    { statKey: 'shared_projects', values: [sharedProjectCount] },
    { statKey: 'user_count', values: [totalUsers] },
    { statKey: 'project_count', values: [projectCount] },
    { statKey: 'file_count', values: [fileCount] },
    { statKey: 'mongodb_storage', values: [mongodbStorageBytes] },
    { statKey: 'overleaf_storage', values: [duResult] },
    { statKey: 'redis_storage', values: [redis.diskBytes, redis.ramBytes] },
    // [availableBytes, totalBytes] for /var/lib/overleaf
    {
      statKey: 'disk_usage',
      values: [diskResult.availableBytes, diskResult.totalBytes],
    },
    // [load1] — the 1-minute load average
    { statKey: 'cpu_load', values: [cpuLoad] },
    // [freeBytes, usedBytes]
    { statKey: 'ram_usage', values: [ram.freeBytes, ram.usedBytes] },
  ]

  for (const { statKey, values } of stats) {
    await upsertStat({ statKey, day, values: values, generatedAt })
  }
}

export async function main() {
  if (!Settings.instanceStats?.enabled) {
    logger.info({ enabled: false }, 'Instance stats collection disabled')
    return
  }

  await mongoose.connectionPromise

  const { runThresholdChecks } = await import('./alertChecker.mjs')

  const now = new Date()
  const day = toUtcMidnight(now)

  logger.info({ day }, 'Collecting instance statistics')
  await collectForDay({ day })

  // Best-effort: retention pruning is non-fatal if it fails (e.g.
  // transient mongo issues).
  await pruneExpired().catch(err => {
    logger.warn({ err }, 'Retention pruning failed (non-fatal)')
  })

  logger.info({ day }, 'Collected instance statistics')

  // Best-effort threshold email alerts; never fails the collection run.
  await runThresholdChecks().catch(err => {
    logger.error({ err }, 'Instance stats threshold check failed (non-fatal)')
  })
}

// Run the collection when executed directly (cron / manual `node`); when
// imported (the /internal/collect-instance-stats route) the caller awaits
// main() so the webapp process survives.
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      logger.err({ err }, 'Failed collecting instance statistics')
      process.exit(1)
    })
}
