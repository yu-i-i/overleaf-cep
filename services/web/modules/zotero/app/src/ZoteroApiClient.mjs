import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { fetchJson, fetchString } from '@overleaf/fetch-utils'
import { User } from '../../../../app/src/models/User.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'

const ZOTERO_API_URL = 'https://api.zotero.org'

/**
 * Decrypt stored Zotero credentials from user record.
 * Returns { apiKey, zoteroUserId } or null if not linked.
 */
async function _getCredentials(userId) {
  const user = await User.findById(userId, 'refProviders.zotero').exec()
  if (!user?.refProviders?.zotero?.apiKeyEncrypted) {
    return null
  }
  try {
    const decrypted = await AccessTokenEncryptor.promises.decryptToJson(
      user.refProviders.zotero.apiKeyEncrypted
    )
    return decrypted
  } catch (err) {
    throw OError.tag(err, 'failed to decrypt Zotero credentials', { userId })
  }
}

/**
 * Make a request to the Zotero API with the user's API key.
 */
async function _zoteroApiRequest(apiKey, path, opts = {}) {
  const url = `${ZOTERO_API_URL}${path}`
  const headers = {
    'Zotero-API-Version': '3',
    'Zotero-API-Key': apiKey,
    ...(opts.headers || {}),
  }
  return { url, headers }
}

/**
 * Get the list of groups for a user.
 */
async function getGroupsForUser(userId) {
  const credentials = await _getCredentials(userId)
  if (!credentials) {
    throw new ZoteroAccountNotLinkedError()
  }
  const { apiKey, zoteroUserId } = credentials
  const { url, headers } = await _zoteroApiRequest(
    apiKey,
    `/users/${zoteroUserId}/groups`
  )
  try {
    const groups = await fetchJson(url, { headers })
    return groups.map(g => ({
      id: String(g.id),
      name: g.data?.name || `Group ${g.id}`,
    }))
  } catch (err) {
    logger.err({ err, userId }, 'error fetching Zotero groups')
    if (err.response?.status === 403) {
      throw new ZoteroForbiddenError('forbidden')
    }
    throw OError.tag(err, 'error fetching Zotero groups')
  }
}

/**
 * Export the user's entire library as BibTeX.
 */
async function getUserLibraryBibtex(userId) {
  const credentials = await _getCredentials(userId)
  if (!credentials) {
    throw new ZoteroAccountNotLinkedError()
  }
  return _fetchBibtex(
    credentials.apiKey,
    `/users/${credentials.zoteroUserId}/items`
  )
}

/**
 * Export a group library as BibTeX.
 */
async function getGroupLibraryBibtex(userId, groupId) {
  const credentials = await _getCredentials(userId)
  if (!credentials) {
    throw new ZoteroAccountNotLinkedError()
  }
  return _fetchBibtex(credentials.apiKey, `/groups/${groupId}/items`)
}

/**
 * Fetch all items from a Zotero library endpoint as BibTeX.
 * Handles pagination (Zotero API limits to 100 items per request).
 */
async function _fetchBibtex(apiKey, basePath) {
  let allBibtex = ''
  let start = 0
  const limit = 100

  while (true) {
    const { url, headers } = await _zoteroApiRequest(apiKey, basePath, {
      headers: {},
    })
    const fullUrl = `${url}?format=bibtex&limit=${limit}&start=${start}`
    try {
      const response = await fetch(fullUrl, { headers })
      if (!response.ok) {
        if (response.status === 403) {
          throw new ZoteroForbiddenError('Zotero API returned 403')
        }
        throw new Error(`Zotero API returned ${response.status}`)
      }
      const bibtex = await response.text()
      if (bibtex.trim()) {
        allBibtex += bibtex + '\n'
      }
      const totalResults = parseInt(
        response.headers.get('Total-Results') || '0',
        10
      )
      start += limit
      if (start >= totalResults) {
        break
      }
    } catch (err) {
      if (err instanceof ZoteroForbiddenError) {
        throw err
      }
      throw OError.tag(err, 'error fetching BibTeX from Zotero', { basePath })
    }
  }
  return allBibtex
}

/**
 * Validate a Zotero API key by calling /keys/{key}.
 * Returns { zoteroUserId } on success, throws on failure.
 */
async function validateApiKey(apiKey) {
  const url = `${ZOTERO_API_URL}/keys/${encodeURIComponent(apiKey)}`
  try {
    const data = await fetchJson(url, {
      headers: { 'Zotero-API-Version': '3' },
    })
    if (!data.userID) {
      throw new Error('Zotero API key response missing userID')
    }
    return { zoteroUserId: String(data.userID) }
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 403) {
      throw new ZoteroForbiddenError('Invalid Zotero API key')
    }
    throw OError.tag(err, 'error validating Zotero API key')
  }
}

/**
 * Link a Zotero account (store encrypted credentials).
 */
async function storeCredentials(userId, apiKey, zoteroUserId) {
  const apiKeyEncrypted = await AccessTokenEncryptor.promises.encryptJson({
    apiKey,
    zoteroUserId: String(zoteroUserId),
  })
  await User.updateOne(
    { _id: userId },
    { $set: { 'refProviders.zotero': { apiKeyEncrypted } } }
  ).exec()
}

/**
 * Unlink a Zotero account.
 */
async function unlinkAccount(userId) {
  await User.updateOne(
    { _id: userId },
    { $unset: { 'refProviders.zotero': 1 } }
  ).exec()
}

export class ZoteroForbiddenError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZoteroForbiddenError'
  }
}

export class ZoteroAccountNotLinkedError extends Error {
  constructor(message = 'Zotero account not linked') {
    super(message)
    this.name = 'ZoteroAccountNotLinkedError'
  }
}

export default {
  getGroupsForUser,
  getUserLibraryBibtex,
  getGroupLibraryBibtex,
  validateApiKey,
  storeCredentials,
  unlinkAccount,
  ZoteroForbiddenError,
  ZoteroAccountNotLinkedError,
}
