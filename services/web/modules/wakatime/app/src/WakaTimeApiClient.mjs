import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Settings from '@overleaf/settings'
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

// ---------------------------------------------------------------------------
// Deployment-managed identity (tools/wakapi_server_compose, trusted-header)
// ---------------------------------------------------------------------------
// When this Overleaf deployment runs its own Wakapi server, users do NOT
// register or paste keys: the logged-in Overleaf user's identity is asserted
// to Wakapi via a trusted HTTP header (WAKAPI_TRUSTED_HEADER_AUTH on the
// Wakapi side), and Wakapi auto-creates the matching user on first use.
// A per-user stored key (manual wakatime.com flow) always takes priority,
// so users who prefer their own wakatime.com account can still link one.
// Configure via services/web/config/settings.defaults.js (wakatime block).

const W = Settings.wakatime || {}

function sharedIdentityActive() {
  return W.sharedIdentity === true
}

function sharedAuthHeaders(email) {
  return {
    'Content-Type': 'application/json',
    // Same UA rules as buildHeaders (wakapi user-agent parser).
    'User-Agent': 'wakatime/1.0.0 (linux) overleaf/1.0 overleaf-wakatime/1.0',
    [W.sharedIdentityHeader || 'Remote-User']: email,
  }
}

/**
 * Resolve how to authenticate on behalf of a user, WITHOUT storing anything:
 *   1. stored credentials (manual wakatime.com / custom key) — always wins
 *   2. shared deployment identity (logged-in user's email via trusted header)
 *   3. nothing (caller decides the error)
 */
async function resolveAuth(userId, email) {
  const credentials = await TokenManager.getCredentials(userId)
  if (credentials) {
    return {
      kind: 'key',
      url: normalizeApiUrl(credentials.apiUrl),
      headers: buildHeaders(credentials.apiKey),
    }
  }
  if (sharedIdentityActive() && email) {
    return {
      kind: 'shared',
      url: normalizeApiUrl(W.sharedIdentityApiUrl),
      headers: sharedAuthHeaders(email),
    }
  }
  return { kind: 'none', url: null, headers: null }
}

function normalizeApiUrl(apiUrl) {
  return (apiUrl || DEFAULT_API_URL).replace(/\/+$/, '')
}

function buildHeaders(apiKey, opts = {}) {
  return {
    Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
    'Content-Type': 'application/json',
    // Must start with "wakatime/" and have a recognized OS token in
    // parens next, or WakaTime/Wakapi's user-agent parser bails out and
    // reports the editor as "unknown" — see wakapi/utils/http.go
    // ParseUserAgent, which requires this exact shape.
    'User-Agent': 'wakatime/1.0.0 (linux) overleaf/1.0 overleaf-wakatime/1.0',
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
 * a WakaTime-compatible account — or is covered by the deployment-managed
 * shared identity (this box's own Wakapi server, trusted-header auth).
 */
async function getConnectionStatus(userId, email) {
  const auth = await resolveAuth(userId, email)
  if (auth.kind === 'none') return { connected: false }

  try {
    await fetchJson(`${auth.url}/users/current`, {
      headers: auth.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return {
      connected: true,
      apiUrl: auth.url,
      shared: auth.kind === 'shared' || undefined,
    }
  } catch (err) {
    logger.warn({ userId, kind: auth.kind, err }, 'WakaTime connection check failed')
    return { connected: false, apiUrl: auth.url, error: true }
  }
}

/**
 * Send a single heartbeat on behalf of a user.
 * https://wakatime.com/developers#heartbeats
 */
async function sendHeartbeat(userId, email, heartbeat) {
  const auth = await resolveAuth(userId, email)
  if (auth.kind === 'none') {
    throw new ServiceNotConfiguredError({
      message: sharedIdentityActive()
        ? 'WakaTime not configured for this user'
        : 'WakaTime credentials missing',
      info: { userId, status: 400 },
    })
  }

  try {
    await fetchNothing(`${auth.url}/users/current/heartbeats`, {
      method: 'POST',
      headers: auth.headers,
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
async function sendHeartbeatsBulk(userId, email, heartbeats) {
  const auth = await resolveAuth(userId, email)
  if (auth.kind === 'none') {
    throw new ServiceNotConfiguredError({
      message: sharedIdentityActive()
        ? 'WakaTime not configured for this user'
        : 'WakaTime credentials missing',
      info: { userId, status: 400 },
    })
  }

  try {
    // WakaTime's /heartbeats.bulk endpoint accepts ONE heartbeat object per
    // request (same contract on wakapi: the .bulk route uses the single
    // heartbeat handler — batch semantics are throughput, not array body).
    // So a "bulk" send is a loop over the .bulk endpoint: sequential, at
    // most MAX_BULK_HEARTBEATS (50) per call, each 2xx-counting.
    for (const heartbeat of heartbeats) {
      await fetchNothing(`${auth.url}/users/current/heartbeats.bulk`, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(heartbeat),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    }
  } catch (err) {
    normalizeApiError(err, 'sendHeartbeatsBulk')
  }
}

/**
 * Get total tracked time for a single project, over the last `range` days
 * (default 7), by requesting a summaries range and summing the per-project
 * breakdown. Works against both wakatime.com and Wakapi.
 */
async function getProjectSummary(userId, email, projectName, range = 7) {
  const auth = await resolveAuth(userId, email)
  if (auth.kind === 'none') return null

  const end = new Date()
  const start = new Date(end.getTime() - range * 24 * 60 * 60 * 1000)
  const qs = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    project: projectName,
  })

  try {
    const summary = await fetchJson(
      `${auth.url}/users/current/summaries?${qs.toString()}`,
      {
        headers: auth.headers,
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
