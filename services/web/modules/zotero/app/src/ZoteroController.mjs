import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import { ZoteroForbiddenError } from './ZoteroApiClient.mjs'

/**
 * GET /zotero/groups
 * Returns the user's Zotero groups (for the create-file modal).
 */
async function getGroups(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const groups = await ZoteroApiClient.getGroupsForUser(userId)
    res.json({ groups })
  } catch (err) {
    if (err instanceof ZoteroForbiddenError) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'zotero_groups_relink',
      })
    }
    logger.err({ err, userId }, 'error fetching Zotero groups')
    res.status(500).json({
      error: 'internal',
      message: 'zotero_groups_loading_error',
    })
  }
}

/**
 * POST /zotero/link
 * Links a Zotero account by validating the user-provided API key
 * and storing the encrypted credentials.
 *
 * Users create their API key at https://www.zotero.org/settings/keys
 * with "Allow library access" and "Allow read access to all groups".
 */
async function link(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { apiKey } = req.body

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return res.status(400).json({ error: 'missing_api_key' })
  }

  try {
    const { zoteroUserId } = await ZoteroApiClient.validateApiKey(
      apiKey.trim()
    )
    await ZoteroApiClient.storeCredentials(userId, apiKey.trim(), zoteroUserId)
    res.json({ success: true })
  } catch (err) {
    if (err instanceof ZoteroForbiddenError) {
      return res.status(400).json({
        error: 'invalid_api_key',
        message: 'zotero_api_key_invalid',
      })
    }
    logger.err({ err, userId }, 'error linking Zotero account')
    res.status(500).json({
      error: 'internal',
      message: 'generic_something_went_wrong',
    })
  }
}

/**
 * POST /zotero/unlink
 * Unlinks the user's Zotero account.
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await ZoteroApiClient.unlinkAccount(userId)
    res.sendStatus(200)
  } catch (err) {
    logger.err({ err, userId }, 'error unlinking Zotero')
    res.sendStatus(500)
  }
}

export default {
  getGroups,
  link,
  unlink,
}
