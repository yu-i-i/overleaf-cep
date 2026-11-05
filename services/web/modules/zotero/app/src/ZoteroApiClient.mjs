import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import {
  fetchNothing,
  fetchJson,
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
  const groups = []
  const limit = 100

  try {
    for (let start = 0; ; start += limit) {
      const page = await fetchJson(`${ZOTERO_API_URL}/users/${zoteroUserId}/groups?limit=${limit}&start=${start}`, {
        headers: buildHeaders(apiKey),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      groups.push(...page.map(g => ({
        id: String(g.id),
        name: g.data?.name || `Group ${g.id}`,
      })))
      if (page.length < limit) break
    }
    return groups

  } catch (err) {
    normalizeApiError(err, 'getGroupsForUser')
  }
}

/**
 * Return the Zotero path for a personal or group library.
 * Identifiers are validated before they become URL path components.
 */
function getLibraryPath(zoteroUserId, groupId) {
  const id = groupId || zoteroUserId
  if (!/^\d+$/.test(String(id))) {
    throw new OError('Invalid Zotero library ID', { status: 400 })
  }
  return groupId ? `/groups/${id}` : `/users/${id}`
}

/**
 * List all collections, including nested collections, in a library.
 */
async function getCollectionsForLibrary(userId, groupId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) return null

  const libraryPath = getLibraryPath(credentials.zoteroUserId, groupId)
  const collections = []
  const limit = 100

  try {
    for (let start = 0; ; start += limit) {
      const page = await fetchJson(
        `${ZOTERO_API_URL}${libraryPath}/collections?limit=${limit}&start=${start}`,
        {
          headers: buildHeaders(credentials.apiKey),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      )
      if (!Array.isArray(page)) throw new OError('Invalid Zotero collections response', { status: 500 })

      collections.push(...page.map(collection => ({
        key: collection.key,
        name: collection.data.name,
        parentCollection: collection.data.parentCollection || null,
      })))
      if (page.length < limit) break
    }
  } catch (err) {
    normalizeApiError(err, 'getCollectionsForLibrary')
  }

  return collections
}

/**
 * Export a library, collection, or personal My Publications view as BibTeX / BibLaTeX.
 */
async function getLibraryBibtex(userId, groupId, format, collectionKey) {
  const credentials = await TokenManager.getCredentials(userId)
  if (!credentials) {
    throw new ServiceNotConfiguredError({
      message: 'RefProvider credentials missing',
      info: { userId, status: 400 }
    })
  }

  const libraryPath = getLibraryPath(credentials.zoteroUserId, groupId)
  // "publications" is a local selector value, not a Zotero collection key.
  const isPublications = collectionKey === 'publications'
  if (isPublications && groupId) {
    throw new OError('My Publications is only available in personal libraries', { status: 400 })
  }
  if (collectionKey != null && !isPublications &&
      (typeof collectionKey !== 'string' || !/^[A-Za-z0-9]{8}$/.test(collectionKey))) {
    throw new OError('Invalid Zotero collection key', { status: 400 })
  }

  let basePath = `${libraryPath}/items`
  if (isPublications) {
    basePath = `${libraryPath}/publications/items`
  } else if (collectionKey) {
    basePath = `${libraryPath}/collections/${collectionKey}/items`
  }

  return _fetchBibtex(credentials.apiKey, basePath, format === 'biblatex' ? 'biblatex' : 'bibtex')
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
      const url = `${ZOTERO_API_URL}${basePath}?format=${format}&limit=${limit}&start=${start}&includeTrashed=0`
      const { body: bibtexFetched, response } = await fetchStringWithResponse(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      const bibtex = bibtexFetched.replace(/^@misc\{noauthor_notitle_nodate(?:-\d+)?,\r?\n\}\r?\n*/gm, '')

      if (bibtex.trim()) allBibtex += bibtex

      const totalResultsHeader = response.headers.get('Total-Results')
      const totalResults = Number(totalResultsHeader)
      if (totalResultsHeader === null || !/^\d+$/.test(totalResultsHeader) ||
          !Number.isSafeInteger(totalResults)) {
        throw new OError('Missing or invalid Zotero Total-Results header', { status: 500 })
      }
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

  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.zotero': 1 } }
  ).exec()

  if (!credentials) return

  try {
    const { apiKey } = credentials
    await fetchNothing(`${ZOTERO_API_URL}/keys/${apiKey}`, {
      method: 'DELETE',
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
     logger.error({ err }, 'failed to delete key from Zotero account')
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
      message: 'Rate limit exceeded',
      info: { operation, status }
    }).withCause(err)
  }

  throw new OError('RefProvider request error', { operation, status }).withCause(err)
}

export default {
  getConnectionStatus,
  getGroupsForUser,
  getCollectionsForLibrary,
  getLibraryBibtex,
  unlinkAccount,
}
