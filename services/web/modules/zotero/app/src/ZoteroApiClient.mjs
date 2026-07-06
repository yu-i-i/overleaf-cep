import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import AbortError from 'node-fetch'
import {
  fetchNothing,
  fetchJson,
  fetchString,
  fetchStringWithResponse,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import { User } from '../../../../app/src/models/User.mjs'
import {
   NotFoundError,
   TooManyRequestsError,
   ServiceNotConfiguredError,
   ForbiddenError,
} from '../../../../app/src/Features/Errors/Errors.js'
import TokenManager from './TokenManager.mjs'

const ZOTERO_API_URL = 'https://api.zotero.org'
const REQUEST_TIMEOUT_MS = 60 * 1000
// TODO: implement conditional requests 

/**
 * Build a header for Zotero API request.
 */
function buildHeaders(apiKey, opts = {}) {
  const headers = {
    'Zotero-API-Version': '3',
    'Zotero-API-Key': apiKey,
    'User-Agent': 'Overleaf-CEP-Zotero',
    ...opts,
  }
  return headers
}

/**
 * Checks connection to Zotero by calling /keys/{key}.
 */
async function getConnectionStatus(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return false

  const { apiKey } = credentials
  try {
    await fetchJson(`${ZOTERO_API_URL}/keys/${apiKey}`, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return true
  } catch (err) {
    normalizeApiError(err, 'getConnectionStatus')
  }
}

/**
 * Get the list of groups for a user.
 */
async function getGroupsForUser(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null

  const { apiKey, zoteroUserId } = credentials
  try {
    const groups = await fetchJson(`${ZOTERO_API_URL}/users/${zoteroUserId}/groups`, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return groups.map(g => ({
      id: String(g.id),
      name: g.data?.name || `Group ${g.id}`,
    }))
  } catch (err) {
    normalizeApiError(err, 'getGroupsForUser')
  }
}

/**
 * Export a library as BibTeX / BibLaTeX.
 */
async function getLibraryBibtex(userId, groupId, format) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) {
    throw new ServiceNotConfiguredError({
      message: 'RefProvider credentials missed',
      info: { userId, status: 400 }
    })
  }

  // Main library or group?
  let basePath
  if (groupId) basePath = `/groups/${groupId}/items`
  else basePath = `/users/${credentials.zoteroUserId}/items`

  return _fetchBibtex(credentials.apiKey, basePath, format)
}

/**
 * Fetch all items from a Zotero library endpoint as BibTeX.
 * Handles pagination (Zotero API limits to 100 items per request).
 */
async function _fetchBibtex(apiKey, basePath, format) {
  const limit = 100
  let allBibtex = ''

  try {
    let start = 0
    const headers = buildHeaders(apiKey)
    while (true) {
      const url = `${ZOTERO_API_URL}${basePath}?format=${format}&limit=${limit}&start=${start}`
      const { body: bibtex, response } = await fetchStringWithResponse(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })

      if (bibtex.trim()) allBibtex += bibtex

      const totalResults = parseInt(response.headers.get('Total-Results') || '0', 10)
      start += limit
      if (start >= totalResults) {
        break
      }
    }
  } catch (err) {
    normalizeApiError(err, '_fetchBibtex')
  }
  return allBibtex
}

/**
 * Unlink a Zotero account.
 */
async function unlinkAccount(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return

  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.zotero': 1 } }
  ).exec()

  try {
    const { apiKey } = credentials
    await fetchNothing(`${ZOTERO_API_URL}/keys/${apiKey}`, {
      method: 'DELETE',
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
     logger.error({ err }, 'failed to detete key from Zotero account')
  }

}

function normalizeApiError(err, operation) {
  logger.error({ operation }, 'Zotero API request failed')

  if (err.name === 'AbortError') {
    throw new OError('RefProvider request timed out', { operation, status: 504 }).withCause(err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new OError('Something wrong with RefProvider request', { operation, status: 500 }).withCause(err)
  }

  const status = err.response?.status || 500

  if (status === 403) {
    throw new ForbiddenError({
       message: 'Access denied',
       info: { operation, status }
    }).withCause(err)
  }

  if (status === 404) {
    throw new NotFoundError({
       message: 'Not found',
       info: { operation, status }
    }).withCause(err)
  }

  if (status === 429) {
    throw new TooManyRequestsError({
      message: 'Rate limit exeeded',
      info: { operation, status }
    }).withCause(err)
  }

  throw new OError('RefProvider request error', { operation, status }).withCause(err)
}

export default {
  getConnectionStatus,
  getGroupsForUser,
  getLibraryBibtex,
  unlinkAccount,
}
