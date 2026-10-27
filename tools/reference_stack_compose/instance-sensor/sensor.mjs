// overleaf-instance-sensor
// Live Prometheus gauges for the overleaf-cep instance statistics.
//
// Sensor definitions ported from PR yu-i-i/overleaf-cep#178
// (services/web/modules/instance-stats/.../collectInstanceStats.mjs):
//   * users     : total count + active (lastActive >= now-24h)
//   * projects  : total count + active (lastUpdated >= now-24h)
//   * files     : docs collection count
//   * storage   : mongodb dbStats.totalSize, overleaf filestore (du of the
//                 data dir), redis RAM (used_memory) + redis disk (aof size)
//   * optional standard/guest split: guest = 'guest-user' in user.adminRoles
//     (the PR#176 segmentation; PR#178 env INSTANCE_STATS_USER_SEGMENTATION_ENABLED)
//
// Instead of the PR's hourly snapshot docs in Mongo, we compute on every
// scrape (cheap counts on this scale; fresh values, no retention state).
// Each probe is isolated: a failing source emits its error counter but the
// rest of the endpoint still answers.

import http from 'node:http'
import { execFile } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { MongoClient } from 'mongodb'
import Redis from 'ioredis'

const execFileAsync = promisify(execFile)

const PORT = Number(process.env.PORT || 9464)
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017/sharelatex'
const REDIS_ADDR = process.env.REDIS_ADDR || 'redis://redis:6379'
const FILESTORE_DATA_DIR = process.env.FILESTORE_DATA_DIR || '/hostdata/filestore'
const SEGMENTATION = String(process.env.SEGMENTATION || 'false') === 'true'
const ACTIVE_WINDOW_MS = Number(process.env.ACTIVE_WINDOW_HOURS || 24) * 3600 * 1000

const GUEST_ADMIN_ROLE = 'guest-user' // PR#176/PR#178 guest definition

const errors = new Map() // name -> failed probe count
let lastSuccessSeconds = 0

const guestUserFilter = () => ({ adminRoles: { $in: [GUEST_ADMIN_ROLE] } })

async function duBytes(path) {
  // byte-exact du of a directory (same semantics as PR#178's duBytes())
  try {
    const { stdout } = await execFileAsync('du', ['-sb', path])
    const m = String(stdout).match(/(\d+)/)
    return m ? Number(m[1]) : 0
  } catch {
    throw new Error(`du failed for ${path}`)
  }
}

function parseRedisInfoInt(info, key) {
  const m = String(info || '').match(new RegExp(`^${key}:(\\d+)`, 'm'))
  return m ? Number(m[1]) : 0
}

async function collect() {
  const nowMs = Date.now()
  const oneAgo = new Date(nowMs - ACTIVE_WINDOW_MS)
  const out = []

  let mongoOk = true
  try {
    const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 })
    await client.connect()
    try {
      const db = client.db() // db name comes from MONGO_URL
      const users = db.collection('users')
      const projects = db.collection('projects')
      const docs = db.collection('docs')

      const totalUsers = await users.countDocuments()
      const activeUsers = await users.countDocuments({ lastActive: { $gte: oneAgo } })
      out.push(
        '# HELP overleaf_instance_users_total Total registered users (segment: all, plus standard/guest when segmentation is enabled).',
        '# TYPE overleaf_instance_users_total gauge',
        `overleaf_instance_users_total{segment="all"} ${totalUsers}`,
        '# HELP overleaf_instance_users_active_24h Users active in the last 24 hours (lastActive >= now-24h).',
        '# TYPE overleaf_instance_users_active_24h gauge',
        `overleaf_instance_users_active_24h{segment="all"} ${activeUsers}`,
      )

      if (SEGMENTATION) {
        const guestFilter = guestUserFilter()
        const guestUsers = await users.countDocuments(guestFilter)
        const activeGuest = await users.countDocuments({
          ...guestFilter,
          lastActive: { $gte: oneAgo },
        })
        out.push(
          `overleaf_instance_users_total{segment="standard"} ${totalUsers - guestUsers}`,
          `overleaf_instance_users_total{segment="guest"} ${guestUsers}`,
          `overleaf_instance_users_active_24h{segment="standard"} ${activeUsers - activeGuest}`,
          `overleaf_instance_users_active_24h{segment="guest"} ${activeGuest}`,
        )
      }

      const totalProjects = await projects.countDocuments()
      const activeProjects = await projects.countDocuments({ lastUpdated: { $gte: oneAgo } })
      const totalFiles = await docs.countDocuments()
      out.push(
        '# HELP overleaf_instance_projects_total Total projects.',
        '# TYPE overleaf_instance_projects_total gauge',
        `overleaf_instance_projects_total ${totalProjects}`,
        '# HELP overleaf_instance_projects_active_24h Projects updated in the last 24 hours (lastUpdated >= now-24h).',
        '# TYPE overleaf_instance_projects_active_24h gauge',
        `overleaf_instance_projects_active_24h ${activeProjects}`,
        '# HELP overleaf_instance_files_total Total documents (files) in the docs collection.',
        '# TYPE overleaf_instance_files_total gauge',
        `overleaf_instance_files_total ${totalFiles}`,
      )

      // PR#178: mongodb_storage = dbStats.totalSize (bytes)
      let mongoBytes = 0
      try {
        const stats = await db.stats()
        mongoBytes = Number(stats?.totalSize ?? 0)
      } catch {
        /* keep 0 */
      }
      out.push(
        '# HELP overleaf_instance_storage_bytes Storage used, bytes. component: mongodb | filestore | redis_ram | redis_disk.',
        '# TYPE overleaf_instance_storage_bytes gauge',
        `overleaf_instance_storage_bytes{component="mongodb"} ${mongoBytes}`,
      )
    } finally {
      await client.close()
    }
  } catch {
    mongoOk = false
    errors.set('mongo', (errors.get('mongo') || 0) + 1)
  }

  // filestore size (SeaweedFS data dir, mounted ro) --------------------------
  let fileOk = true
  try {
    const bytes = await duBytes(FILESTORE_DATA_DIR)
    out.push(`overleaf_instance_storage_bytes{component="filestore"} ${bytes}`)
  } catch {
    fileOk = false
    errors.set('filestore', (errors.get('filestore') || 0) + 1)
  }

  // redis storage: RAM (used_memory) + disk (aof_current_size) ----------------
  let redisOk = true
  try {
    const r = new Redis(REDIS_ADDR, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    })
    try {
      const usedMemory = parseRedisInfoInt(await r.info('memory'), 'used_memory')
      let aof = 0
      try {
        aof = parseRedisInfoInt(await r.info('persistence'), 'aof_current_size')
      } catch {
        /* aof may be disabled — 0 is the true value */
      }
      out.push(
        `overleaf_instance_storage_bytes{component="redis_ram"} ${usedMemory}`,
        `overleaf_instance_storage_bytes{component="redis_disk"} ${aof}`,
      )
    } finally {
      try {
        r.disconnect()
      } catch {
        /* noop */
      }
    }
  } catch {
    redisOk = false
    errors.set('redis', (errors.get('redis') || 0) + 1)
  }

  const up = mongoOk && fileOk && redisOk ? 1 : 0
  if (up === 1) lastSuccessSeconds = (Date.now() / 1000) | 0

  out.push(
    '# HELP overleaf_instance_sensor_up 1 when the last scrape computed all probes successfully.',
    '# TYPE overleaf_instance_sensor_up gauge',
    `overleaf_instance_sensor_up ${up}`,
    '# HELP overleaf_instance_sensor_last_success_timestamp_seconds Unix time of the last fully successful scrape.',
    '# TYPE overleaf_instance_sensor_last_success_timestamp_seconds gauge',
    `overleaf_instance_sensor_last_success_timestamp_seconds ${lastSuccessSeconds}`,
    '# HELP overleaf_instance_sensor_errors_total Failed probe count since start (name=mongo|filestore|redis).',
    '# TYPE overleaf_instance_sensor_errors_total counter',
  )
  for (const [name, n] of errors) {
    out.push(`overleaf_instance_sensor_errors_total{name="${name}"} ${n}`)
  }
  return `${out.join('\n')}\n`
}

const server = http.createServer(async (req, res) => {
  if (req.url !== '/metrics') {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found\n')
    return
  }
  const t0 = performance.now()
  const body = await collect()
  const dt = (performance.now() - t0) / 1000
  res.writeHead(200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`overleaf-instance-sensor listening on :${PORT}`)
})
