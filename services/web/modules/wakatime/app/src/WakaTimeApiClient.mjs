import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import {
  fetchNothing,
  fetchJson,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import {
  NotFoundError,
  TooManyRequestsError,
  ServiceNotConfiguredError,
  ForbiddenError,
} from '../../../../app/src/Features/Errors/Errors.js'
import TokenManager from './TokenManager.mjs'

const DEFAULT_API_URL = 'https://wakatime.com/api/v1'
const REQUEST_TIMEOUT_MS = 15 * 1000

function normalizeApiUrl(apiUrl) {
  return (apiUrl || DEFAULT_API_URL).replace(/\/+$/, '')
}

function buildHeaders(apiKey, opts = {}) {
  return {
    Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Overleaf-CEP-WakaTime',
    ...opts,
  }
}

/**
 * Verify a (apiUrl, apiKey) pair works, without persisting anything.
 * Uses GET /users/current, which every WakaTime-compatible server
 * (wakatime.com and Wakapi) implements for auth verification.
 */
async function verifyCredentials(apiUrl, apiKey) {
  const url = normalizeApiUrl(apiUrl)
  try {
    await fetchJson(`${url}/users/current`, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return true
  } catch (err) {
    normalizeApiError(err, 'verifyCredentials')
  }
}

/**
 * Checks whether the user has linked (and can still authenticate with)
 * a WakaTime-compatible account.
 */
async function getConnectionStatus(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return { connected: false }

  try {
    await verifyCredentials(credentials.apiUrl, credentials.apiKey)
    return { connected: true, apiUrl: credentials.apiUrl }
  } catch (err) {
    logger.warn({ userId, err }, 'WakaTime credentials no longer valid')
    return { connected: false, apiUrl: credentials.apiUrl, error: true }
  }
}

/**
 * Send a single heartbeat on behalf of a user.
 * https://wakatime.com/developers#heartbeats
 */
async function sendHeartbeat(userId, heartbeat) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) {
    throw new ServiceNotConfiguredError({
      message: 'WakaTime credentials missing',
      info: { userId, status: 400 },
    })
  }

  const url = normalizeApiUrl(credentials.apiUrl)
  try {
    await fetchNothing(`${url}/users/current/heartbeats`, {
      method: 'POST',
      headers: buildHeaders(credentials.apiKey),
      body: JSON.stringify(heartbeat),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    normalizeApiError(err, 'sendHeartbeat')
  }
}

/**
 * Send a batch of heartbeats on behalf of a user.
 * https://wakatime.com/developers#heartbeats (bulk)
 */
async function sendHeartbeatsBulk(userId, heartbeats) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) {
    throw new ServiceNotConfiguredError({
      message: 'WakaTime credentials missing',
      info: { userId, status: 400 },
    })
  }

  const url = normalizeApiUrl(credentials.apiUrl)
  try {
    await fetchNothing(`${url}/users/current/heartbeats.bulk`, {
      method: 'POST',
      headers: buildHeaders(credentials.apiKey),
      body: JSON.stringify(heartbeats),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    normalizeApiError(err, 'sendHeartbeatsBulk')
  }
}

/**
 * Get total tracked time for a single project, over the last `range` days
 * (default 7), by requesting a summaries range and summing the per-project
 * breakdown. Works against both wakatime.com and Wakapi.
 */
async function getProjectSummary(userId, projectName, range = 7) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null

  const url = normalizeApiUrl(credentials.apiUrl)
  const end = new Date()
  const start = new Date(end.getTime() - range * 24 * 60 * 60 * 1000)
  const qs = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    project: projectName,
  })

  try {
    const summary = await fetchJson(
      `${url}/users/current/summaries?${qs.toString()}`,
      {
        headers: buildHeaders(credentials.apiKey),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )

    const totalSeconds = (summary.data || []).reduce((sum, day) => {
      const projectEntry = (day.projects || []).find(
        p => p.name === projectName
      )
      return sum + (projectEntry?.total_seconds || 0)
    }, 0)

    return { totalSeconds, rangeDays: range }
  } catch (err) {
    normalizeApiError(err, 'getProjectSummary')
  }
}

async function unlinkAccount(userId) {
  await TokenManager.removeCredentials(userId)
}

function normalizeApiError(err, operation) {
  logger.error({ operation }, 'WakaTime API request failed')

  if (err.name === 'AbortError') {
    throw new OError('WakaTime request timed out', {
      operation,
      status: 504,
    }).withCause(err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new OError('Something wrong with WakaTime request', {
      operation,
      status: 500,
    }).withCause(err)
  }

  const status = err.response?.status || 500

  if (status === 401 || status === 403) {
    throw new ForbiddenError({
      message: 'Access denied',
      info: { operation, status },
    }).withCause(err)
  }

  if (status === 404) {
    throw new NotFoundError({
      message: 'Not found',
      info: { operation, status },
    }).withCause(err)
  }

  if (status === 429) {
    throw new TooManyRequestsError({
      message: 'Rate limit exceeded',
      info: { operation, status },
    }).withCause(err)
  }

  throw new OError('WakaTime request error', { operation, status }).withCause(
    err
  )
}

export default {
  verifyCredentials,
  getConnectionStatus,
  sendHeartbeat,
  sendHeartbeatsBulk,
  getProjectSummary,
  unlinkAccount,
}
