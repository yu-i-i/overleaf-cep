/* eslint-disable @overleaf/require-script-runner */
import RedisWrapper from '@overleaf/redis-wrapper'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { db, ObjectId, connectionPromise } from '../app/src/infrastructure/mongodb.mjs'

logger.initialize('process-project-change-notifications')

// Connect to the same Redis instance used by document-updater.
// In CE/SE all redis configs share the same server.
const redisClient = RedisWrapper.createClient(Settings.redis.documentupdater)

const KEY_PATTERN = 'ProjectNotificationTimestamp:*'

// Only send notifications for changes that are at least MIN_DELAY_MS old.
// This debounces rapid edits so we don't notify while a user is actively editing.
// Uses its own env var and defaults to 2 minutes, independent of the comment-mention delay.
const MIN_DELAY_MS = process.env.TRACKED_CHANGES_NOTIFICATION_DELAY_MS
  ? parseInt(process.env.TRACKED_CHANGES_NOTIFICATION_DELAY_MS, 10)
  : 2 * 60 * 1000 // 2 minutes

const DEFAULT_PREFS = {
  trackedChangesOnOwnProject: true,
  trackedChangesOnInvitedProject: true,
}

async function main() {
  await connectionPromise

  const now = Date.now()
  const keys = await scanAllKeys(KEY_PATTERN)

  logger.info(
    { count: keys.length },
    'scanned for projects with pending tracked-change notifications'
  )

  let processedCount = 0
  for (const key of keys) {
    const projectId = extractProjectId(key)
    if (!projectId) {
      logger.warn({ key }, 'could not extract projectId from notification key')
      continue
    }

    const timestampStr = await redisClient.get(key)
    if (!timestampStr) continue

    const timestamp = parseInt(timestampStr, 10)
    if (isNaN(timestamp)) {
      logger.warn({ key, timestampStr }, 'invalid timestamp in notification key')
      continue
    }

    // Debounce: skip if the change was made too recently
    const ageMs = now - timestamp
    if (ageMs < MIN_DELAY_MS) {
      logger.debug(
        { projectId, ageMs },
        'skipping: tracked change too recent, will retry next cycle'
      )
      continue
    }

    try {
      const notifiedCount = await processProjectNotification(projectId)

      // Best-effort delete.  If this fails, the key will be re-processed on
      // the next cron run (which may result in duplicate notifications, but
      // that is preferable to silent failures).
      await redisClient.del(key)

      processedCount++
      logger.info(
        { projectId, notifiedCount },
        'queued tracked-change email notifications'
      )
    } catch (err) {
      logger.warn(
        { err, projectId },
        'failed to process project tracked-change notification'
      )
    }
  }

  logger.info(
    { processedCount },
    'finished processing project tracked-change notifications'
  )
}

async function processProjectNotification(projectId) {
  // Load project metadata
  const project = await db.projects.findOne(
    { _id: new ObjectId(projectId) },
    {
      projection: {
        owner_ref: 1,
        collaberator_refs: 1,
        readOnly_refs: 1,
        tokenAccessReadAndWrite_refs: 1,
        tokenAccessReadOnly_refs: 1,
        name: 1,
      },
    }
  )

  if (!project) {
    logger.warn(
      { projectId },
      'project not found for tracked-change notification'
    )
    return 0
  }

  // Collect all project member user IDs
  const memberIds = new Set()
  if (project.owner_ref) {
    memberIds.add(project.owner_ref.toString())
  }
  for (const field of [
    project.collaberator_refs,
    project.readOnly_refs,
    project.tokenAccessReadAndWrite_refs,
    project.tokenAccessReadOnly_refs,
  ]) {
    if (Array.isArray(field)) {
      for (const id of field) {
        if (id) memberIds.add(id.toString())
      }
    }
  }

  if (!memberIds.size) return 0

  const memberIdsArray = [...memberIds]
  const ownerId = project.owner_ref?.toString()
  const projectName = project.name || 'project'

  // Load per-project notification preferences
  const preferencesMap = await loadProjectPreferences(
    projectId,
    memberIdsArray
  )

  // Load global email preferences (the "enabled" toggle on the user)
  const emailPreferencesMap = await loadUserEmailPreferences(memberIdsArray)

  const emailNotifications = []
  for (const userId of memberIdsArray) {
    const prefs = preferencesMap.get(userId) || DEFAULT_PREFS
    const emailPrefs = emailPreferencesMap.get(userId)

    const isOwner = userId === ownerId
    const wantsNotif = isOwner
      ? prefs.trackedChangesOnOwnProject
      : prefs.trackedChangesOnInvitedProject

    if (!wantsNotif) continue

    // Respect the global "emails enabled" toggle
    if (emailPrefs && emailPrefs.enabled === false) continue

    emailNotifications.push({
      recipient_id: new ObjectId(userId),
      emailType: 'trackedChangesNotification',
      opts: {
        projectId,
        projectName,
      },
      scheduledAt: new Date(),
      createdAt: new Date(),
    })
  }

  if (emailNotifications.length > 0) {
    await db.emailNotifications.insertMany(emailNotifications)
  }

  return emailNotifications.length
}

async function loadProjectPreferences(projectId, userIds) {
  if (!userIds.length) return new Map()

  const docs = await db.notificationsPreferences
    .find({
      project_id: new ObjectId(projectId),
      user_id: { $in: userIds.map(id => new ObjectId(id)) },
    })
    .toArray()

  const map = new Map()
  for (const doc of docs) {
    map.set(doc.user_id.toString(), {
      trackedChangesOnOwnProject: Boolean(doc.trackedChangesOnOwnProject),
      trackedChangesOnInvitedProject: Boolean(
        doc.trackedChangesOnInvitedProject
      ),
    })
  }
  return map
}

async function loadUserEmailPreferences(userIds) {
  if (!userIds.length) return new Map()

  const users = await db.users
    .find(
      { _id: { $in: userIds.map(id => new ObjectId(id)) } },
      { projection: { notificationEmailPreferences: 1 } }
    )
    .toArray()

  const map = new Map()
  for (const user of users) {
    map.set(user._id.toString(), {
      enabled: user.notificationEmailPreferences?.enabled !== false,
    })
  }
  return map
}

async function scanAllKeys(pattern) {
  const keys = []
  const stream = redisClient.scanStream({ match: pattern, count: 100 })
  for await (const batch of stream) {
    keys.push(...batch)
  }
  return keys
}

function extractProjectId(key) {
  const match = key.match(/ProjectNotificationTimestamp:\{(.*?)\}/)
  return match ? match[1] : null
}

try {
  await main()
  process.exit(0)
} catch (err) {
  logger.error({ err }, 'error processing project tracked-change notifications')
  process.exit(1)
} finally {
  await redisClient.disconnect().catch(() => {})
}
