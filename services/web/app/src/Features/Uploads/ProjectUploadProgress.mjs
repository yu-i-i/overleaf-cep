import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import RedisWrapper from '../../infrastructure/RedisWrapper.mjs'

const rclient = RedisWrapper.client('web')

const KEY_PREFIX = 'bulk-upload-progress:'
const TTL_SECONDS = 60 * 60 // 1 hour

/**
 * @typedef {object} ProjectUploadResult
 * @property {string} id
 * @property {string} name
 * @property {'importing' | 'success' | 'failed'} status
 * @property {string} [projectId]
 */

/**
 * @typedef {object} BulkUploadProgressRecord
 * @property {string} ownerId
 * @property {'in_progress' | 'complete' | 'failed' | 'cancelled'} status
 * @property {number} total
 * @property {number} completed
 * @property {number} failed
 * @property {ProjectUploadResult[]} results
 * @property {string} [error] - i18n key of the error, if the import failed
 * @property {string} updatedAt
 */

function key(importId) {
  return `${KEY_PREFIX}${importId}`
}

/**
 * @param {string | null} raw
 * @returns {BulkUploadProgressRecord | null}
 */
function parseRecord(raw) {
  if (raw == null)
    return null

  try {
    return JSON.parse(raw)
  } catch (err) {
    logger.warn({ err, raw }, 'corrupt bulk upload progress record')
    return null
  }
}

/**
 * @param {string} importId
 * @returns {Promise<BulkUploadProgressRecord | null>}
 */
async function getRecord(importId) {
  try {
    return parseRecord(await rclient.get(key(importId)))
  } catch (err) {
    logger.error({ err, importId }, 'error reading bulk upload progress from redis')
    return null
  }
}

/**
 * @param {string} importId
 * @param {BulkUploadProgressRecord} record
 */
async function saveRecord(importId, record) {
  try {
    await rclient.set(key(importId), JSON.stringify(record), 'EX', TTL_SECONDS)
  } catch (err) {
    logger.error({ err, importId }, 'error saving bulk upload progress to redis')
  }
}

export const promises = {
  /**
   * @param {string} ownerId
   * @returns {Promise<string>} the new importId
   */
  async create(ownerId) {
    const importId = crypto.randomUUID()
    await saveRecord(importId, {
      ownerId,
      status: 'in_progress',
      total: 0,
      completed: 0,
      failed: 0,
      results: [],
      updatedAt: new Date().toISOString(),
    })
    return importId
  },

  /**
   * @param {string} importId
   * @param {number} total
   */
  async setTotal(importId, total) {
    const record = await getRecord(importId)
    if (record == null)
      return

    record.total = total
    record.updatedAt = new Date().toISOString()
    await saveRecord(importId, record)
  },

  /**
   * @param {string} importId
   * @param {ProjectUploadResult} result
   */
  async recordResult(importId, result) {
    const record = await getRecord(importId)
    if (record == null)
      return

    const existing = record.results.find(existingResult => existingResult.id === result.id)
    if (existing)
      Object.assign(existing, result)
    else
      record.results.push(result)

    if (result.status === 'success')
      record.completed += 1
    else if (result.status === 'failed')
      record.failed += 1

    record.updatedAt = new Date().toISOString()
    await saveRecord(importId, record)
  },

  /**
   * @param {string} importId
   * @param {{ status: 'complete' | 'failed', error?: string }} outcome
   */
  async finish(importId, { status, error }) {
    const record = await getRecord(importId)
    if (record == null) 
      return

    record.status = status

    if (error != null)
      record.error = error

    record.updatedAt = new Date().toISOString()
    await saveRecord(importId, record)
  },

  /**
   * @param {string} ownerId
   * @param {string} importId
   * @returns {Promise<boolean>} true if an in-progress import was cancelled
   */
  async cancel(ownerId, importId) {
    const record = await getRecord(importId)
    if (record == null || record.ownerId !== ownerId)
      return false

    if (record.status !== 'in_progress')
      return false

    record.status = 'cancelled'
    record.updatedAt = new Date().toISOString()
    await saveRecord(importId, record)
    return true
  },

  /**
   * @param {string} importId
   * @returns {Promise<boolean>}
   */
  async isCancelled(importId) {
    const record = await getRecord(importId)
    return record != null && record.status === 'cancelled'
  },

  /**
   * @param {string} ownerId
   * @param {string} importId
   * @returns {Promise<BulkUploadProgressRecord | null>}
   */
  async get(ownerId, importId) {
    const record = await getRecord(importId)
    if (record == null)
      return null

    if (record.ownerId !== ownerId)
      return null

    return record
  },
}

export default {
  promises,
}
