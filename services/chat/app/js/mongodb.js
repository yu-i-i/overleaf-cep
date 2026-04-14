// @ts-check

import Metrics from '@overleaf/metrics'
import Settings from '@overleaf/settings'
import MongoUtils from '@overleaf/mongo-utils'
import { MongoClient } from 'mongodb'

export { ObjectId } from 'mongodb'

export const mongoClient = new MongoClient(
  Settings.mongo.url,
  Settings.mongo.options
)
const mongoDb = mongoClient.db()

export const db = {
  messages: mongoDb.collection('messages'),
  rooms: mongoDb.collection('rooms'),
  users: mongoDb.collection('users'),
  projects: mongoDb.collection('projects'),
  notifications: mongoDb.collection('notifications'),
  notificationsPreferences: mongoDb.collection('notificationsPreferences'),
  notificationsPreferencesLegacy: mongoDb.collection('notifications_preferences'),
  emailNotifications: mongoDb.collection('emailNotifications'),
}

Metrics.mongodb.monitor(mongoClient)

export async function cleanupTestDatabase() {
  await MongoUtils.cleanupTestDatabase(mongoClient)
}
