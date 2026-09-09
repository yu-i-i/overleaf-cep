import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { GitHubSyncUserCredentials } from '../models/githubSyncUserCredentials.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'

const { normalizeQuery } = Mongo

// GS-07: serialize the per-user read-modify-write credential operations so
// concurrent saves (e.g. linking two servers at once) can't lose updates.
const userLocks = new Map()
function withUserLock(userId, fn) {
  const prev = userLocks.get(userId) || Promise.resolve()
  const run = prev.then(() => fn())
  userLocks.set(userId, run.catch(() => {}))
  return run
}

// Provider type for git servers (runtime-compatible)
const validProviders = ['github', 'gitlab', 'gitea', 'forgejo']

/**
 * Get default server URL for a provider
 */
function getDefaultServerUrl(provider) {
  const defaults = {
    github: 'https://github.com',
    gitlab: 'https://gitlab.com',
    gitea: 'https://gitea.io',
    forgejo: 'https://forgejo.org'
  }
  return defaults[provider] || 'https://github.com'
}

async function encryptAccessToken(accessToken) {
  try {
    return await AccessTokenEncryptor.encryptJson(accessToken)
  } catch (err) {
    throw OError.tag('failed to encrypt token', err)
  }
}

async function decryptAccessToken(tokenEncrypted) {
  try {
    return await AccessTokenEncryptor.decryptToJson(tokenEncrypted)
  } catch (err) {
    throw new InvalidTokenError('failed to decrypt token', { status: 401 }, err)
  }
}

// --------------------------------------------------------------------------
// Credential model (two kinds):
//
// 1. PAT entries — one per (provider, serverUrl, username). A user may have
//    many per provider and many per server URL (different accounts).
//      tokens[provider][serverUrl][username] = encrypted
//      servers[provider][serverUrl][username] = { createdAt, lastUsedAt }
//    Legacy documents may still hold `tokens[provider][serverUrl] = "string"`
//    (single account, username from the servers map). Those remain readable
//    everywhere and are migrated to the 3-level shape on first write.
//
// 2. GitHub OAuth slot — one special account for github.com, linked via the
//    OAuth flow, stored in the reserved top-level `github` field as
//      { token: encrypted, username, linkedAt }
//    (a bare string is the pre-schema legacy shape and stays readable).
//    The OAuth account coexists with any number of PAT entries.
// --------------------------------------------------------------------------

function serverId(provider, serverUrl, username) {
  return `${provider}:${serverUrl}:${username || ''}`
}

/**
 * Enumerate PAT entries stored for one (provider, url) bucket. Handles both
 * the legacy single-string shape and the current username-keyed map.
 */
function enumerateBucket(bucket, legacyUsername) {
  if (typeof bucket === 'string') {
    return [{ username: legacyUsername || '', value: bucket }]
  }
  if (bucket && typeof bucket === 'object') {
    return Object.entries(bucket)
      .filter(([, v]) => typeof v === 'string')
      .map(([u, v]) => ({ username: u, value: v }))
  }
  return []
}

// ------------------------- PAT entries -------------------------- //

/**
 * Save a PAT for (provider, serverUrl, username). Saving under an existing
 * (provider, serverUrl, username) replaces that account's token (identity),
 * never another account's.
 */
async function _saveUserPAT(userId, provider, serverUrl, username, pat) {
  const tokenEncrypted = await encryptAccessToken(pat)

  // Normalize server URL (remove trailing slash)
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')
  const cleanUsername = (username || '').trim()
  const now = new Date()

  // Read-modify-write: NEVER build Mongo dot-paths from the (dotted) server
  // URL, or the driver will split the URL on the dot into nested keys.
  const doc = (await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))) ||
    new GitHubSyncUserCredentials({ userId, createdAt: now })

  const tokens = { ...(doc.tokens || {}) }
  tokens[provider] = { ...(tokens[provider] || {}) }
  const bucket = tokens[provider][normalizedServerUrl]
  let usernameMap = {}
  if (typeof bucket === 'string') {
    // Legacy single-account bucket: migrate to the username-keyed shape
    const legacyUsername =
      doc.servers?.[provider]?.[normalizedServerUrl]?.username || ''
    usernameMap = { [legacyUsername || '']: bucket }
  } else if (bucket && typeof bucket === 'object') {
    usernameMap = { ...bucket }
  }
  usernameMap[cleanUsername] = tokenEncrypted
  tokens[provider][normalizedServerUrl] = usernameMap
  doc.tokens = tokens
  doc.markModified('tokens')

  const servers = { ...(doc.servers || {}) }
  servers[provider] = { ...(servers[provider] || {}) }
  const serverBucket = servers[provider][normalizedServerUrl]
  let serverMap = {}
  if (serverBucket && typeof serverBucket === 'object' && serverBucket.username !== undefined) {
    // Legacy single-entry shape: { url, username, createdAt, lastUsedAt }
    const legacyUsername = serverBucket.username || ''
    serverMap = legacyUsername ?
      { [legacyUsername]: { createdAt: serverBucket.createdAt || now, lastUsedAt: now } } :
      {}
  } else if (serverBucket && typeof serverBucket === 'object') {
    serverMap = { ...serverBucket }
  }
  const prev = serverMap[cleanUsername]
  serverMap[cleanUsername] = {
    createdAt: prev?.createdAt || now,
    lastUsedAt: now
  }
  servers[provider][normalizedServerUrl] = serverMap
  doc.servers = servers
  doc.markModified('servers')
  doc.lastUsedAt = now
  await doc.save()
}

/**
 * Resolve stored credentials for (provider, serverUrl[, username]).
 * PAT entries win for an exact (provider, url, username) match; the GitHub
 * OAuth slot is the fallback account for github.com.
 * Returns { token, serverUrl, username, source } or throws InvalidTokenError.
 */
async function getUserPATCredentials(userId, provider, serverUrl, username) {
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')
  const wantUsername = (username || '').trim()

  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) {
    throw new InvalidTokenError('no user token', { userId, status: 400 })
  }

  const bucket = credentials.tokens?.[provider]?.[normalizedServerUrl]
  const legacyUsername = credentials.servers?.[provider]?.[normalizedServerUrl]?.username
  const entries = enumerateBucket(bucket, legacyUsername)

  let match
  if (wantUsername) {
    match = entries.find(e => e.username === wantUsername)
  } else if (entries.length === 1) {
    match = entries[0]
  } else if (entries.length > 1) {
    throw new InvalidTokenError(
      `multiple git accounts are linked for ${provider} ${normalizedServerUrl}; specify one of: ${entries.map(e => e.username || '(unknown)').join(', ')}`,
      { userId, provider, serverUrl: normalizedServerUrl, status: 400 }
    )
  }

  let token
  let resolvedUsername = match?.username || ''
  let source = 'pat'
  if (match?.value) {
    token = await decryptAccessToken(match.value)
  } else if (
    provider === 'github' &&
    normalizedServerUrl === getDefaultServerUrl('github')
  ) {
    // OAuth slot (object shape) or pre-schema legacy string
    const slotToken = oauthSlotToken(credentials)
    if (slotToken) {
      token = await decryptAccessToken(slotToken)
      const linked = await getOAuth(userId)
      resolvedUsername = wantUsername || linked.username || ''
      source = 'oauth'
    }
  }

  if (!token) {
    throw new InvalidTokenError(
      `no token for ${provider} server ${normalizedServerUrl}`,
      { userId, provider, serverUrl: normalizedServerUrl, status: 400 }
    )
  }

  if (source === 'pat') {
    await touchLastUsed(userId, provider, normalizedServerUrl, resolvedUsername)
  }
  return { token, serverUrl: normalizedServerUrl, username: resolvedUsername, source }
}

/**
 * Get PAT for (provider, serverUrl[, username]). Without a username, the
 * single stored entry is used; with several accounts on the same server the
 * caller must name one (never silently pick a possibly-wrong account).
 */
async function getUserPAT(userId, provider, serverUrl, username) {
  const creds = await getUserPATCredentials(userId, provider, serverUrl, username)
  return creds.token
}

/** Refresh lastUsedAt without touching the token itself. */
async function touchLastUsed(userId, provider, serverUrl, username) {
  try {
    const doc = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
    if (!doc) return
    const servers = { ...(doc.servers || {}) }
    servers[provider] = { ...(servers[provider] || {}) }
    const serverBucket = servers[provider][serverUrl]
    const now = new Date()
    if (serverBucket && typeof serverBucket === 'object' && serverBucket.username !== undefined) {
      // legacy single-entry shape
      serverBucket.lastUsedAt = now
      doc.servers = servers
      doc.markModified('servers')
      await doc.save()
      return
    }
    const serverMap = serverBucket && typeof serverBucket === 'object' ? { ...serverBucket } : {}
    const entry = serverMap[username || '']
    if (entry) {
      entry.lastUsedAt = now
      servers[provider][serverUrl] = serverMap
      doc.servers = servers
      doc.markModified('servers')
      await doc.save()
    }
  } catch (err) {
    logger.debug({ err, userId, provider }, 'could not refresh lastUsedAt (non-fatal)')
  }
}

/**
 * List all PAT entries a user has stored tokens for (for status checks).
 * Each PAT row: { id, provider, url, username, source: 'pat' } plus, when
 * linked, the GitHub OAuth slot as { ..., source: 'oauth' }.
 */
async function getPublicServers(userId) {
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))

  if (!credentials) return []

  const serversList = []
  const tokens = credentials.tokens || {}
  for (const [provider, urlMap] of Object.entries(tokens)) {
    if (typeof urlMap !== 'object' || urlMap === null) continue // legacy corruption guard
    for (const [serverUrl, bucket] of Object.entries(urlMap)) {
      const legacyUsername = credentials.servers?.[provider]?.[serverUrl]?.username
      for (const entry of enumerateBucket(bucket, legacyUsername)) {
        const username = entry.username || legacyUsername || ''
        serversList.push({
          id: serverId(provider, serverUrl, username),
          provider,
          url: serverUrl,
          username,
          source: 'pat'
        })
      }
    }
  }

  // GitHub OAuth slot (object or legacy string) -> one virtual oauth server
  const oauthLinked = typeof credentials.github === 'string' ||
    (credentials.github && typeof credentials.github === 'object' && credentials.github.token)
  if (oauthLinked) {
    const { username } = await getOAuth(userId)
    const url = getDefaultServerUrl('github')
    serversList.push({
      id: serverId('github', url, username),
      provider: 'github',
      url,
      username,
      source: 'oauth'
    })
  }

  return serversList
}

// Backwards-compatible alias (some call sites read "linked servers")
async function getLinkedServers(userId) {
  return getPublicServers(userId)
}

/**
 * Remove a PAT entry.
 * - with username: remove exactly that (provider, url, username) account
 * - without: remove the whole (provider, url) bucket (all accounts)
 */
async function _removeUserPAT(userId, provider, serverUrl, username) {
  const normalizedServerUrl = serverUrl?.replace(/\/$/, '')
  const hasUsername = username !== undefined && username !== null
  const cleanUsername = hasUsername ? (username || '').trim() : undefined

  const doc = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!doc) return

  for (const mapName of ['tokens', 'servers']) {
    const map = { ...((doc[mapName] || {})) }
    if (normalizedServerUrl) {
      if (map[provider]) {
        const bucket = map[provider][normalizedServerUrl]
        if (!hasUsername) {
          delete map[provider][normalizedServerUrl]
        } else if (typeof bucket === 'string' || bucket?.username !== undefined) {
          // Legacy single-entry shape: delete the whole bucket
          delete map[provider][normalizedServerUrl]
        } else if (bucket && typeof bucket === 'object') {
          const next = { ...bucket }
          delete next[cleanUsername]
          if (Object.keys(next).length) {
            map[provider][normalizedServerUrl] = next
          } else {
            delete map[provider][normalizedServerUrl]
          }
        }
      }
    } else {
      delete map[provider]
    }
    if (map[provider] && !Object.keys(map[provider]).length) {
      delete map[provider]
    }
    doc[mapName] = map
    doc.markModified(mapName)
  }

  doc.lastUsedAt = new Date()
  await doc.save()
}

/**
 * Get all registered servers for a user (raw map, legacy readers)
 */
async function getUserServers(userId) {
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) return {}
  return credentials.servers || {}
}

/**
 * Add a server configuration (no token) for (provider, url, username)
 */
async function _addServerConfig(userId, provider, serverUrl, username) {
  const normalizedServerUrl = serverUrl.replace(/\/$/, '')
  const cleanUsername = (username || '').trim()

  const doc = (await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))) ||
    new GitHubSyncUserCredentials({ userId, createdAt: new Date() })
  const now = new Date()

  const servers = { ...(doc.servers || {}) }
  servers[provider] = { ...(servers[provider] || {}) }
  const bucket = servers[provider][normalizedServerUrl]
  let serverMap = {}
  if (bucket && typeof bucket === 'object' && bucket.username !== undefined) {
    const legacyUsername = bucket.username || ''
    serverMap = legacyUsername ? { [legacyUsername]: { createdAt: bucket.createdAt || now, lastUsedAt: now } } : {}
  } else if (bucket && typeof bucket === 'object') {
    serverMap = { ...bucket }
  }
  const prev = serverMap[cleanUsername]
  serverMap[cleanUsername] = {
    createdAt: prev?.createdAt || now,
    lastUsedAt: now
  }
  servers[provider][normalizedServerUrl] = serverMap
  doc.servers = servers
  doc.markModified('servers')
  doc.lastUsedAt = now
  await doc.save()

  return { success: true, serverUrl: normalizedServerUrl }
}

// ------------------------- GitHub OAuth slot -------------------------- //

/**
 * State of the GitHub OAuth account (the dedicated slot, separate from PAT
 * entries). Returns { linked, username }.
 */
async function getOAuth(userId) {
  try {
    const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
    if (!credentials) return { linked: false, username: '' }

    const github = credentials.github
    if (typeof github === 'string') {
      // Legacy shape: raw encrypted token, username unknown.
      return { linked: true, username: '' }
    }
    if (github && typeof github === 'object' && github.token) {
      return { linked: true, username: github.username || '' }
    }
    return { linked: false, username: '' }
  } catch (err) {
    // A corrupted slot must never break the settings page.
    logger.warn({ err, userId }, 'could not read github oauth slot; treating as not linked')
    return { linked: false, username: '' }
  }
}

/** Encrypted token of the OAuth slot (legacy strings and objects). */
function oauthSlotToken(credentials) {
  const github = credentials?.github
  if (typeof github === 'string') return github
  if (github && typeof github === 'object') return github.token
  return undefined
}

/**
 * Save the GitHub OAuth account (token + login). Coexists with PAT entries;
 * only the OAuth slot itself is replaced.
 */
async function _saveOAuth(userId, token, username) {
  const tokenEncrypted = await encryptAccessToken(token)
  const now = new Date()

  const doc = (await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))) ||
    new GitHubSyncUserCredentials({ userId, createdAt: now })

  doc.github = {
    token: tokenEncrypted,
    username: (username || '').trim(),
    linkedAt: now
  }
  doc.markModified('github')
  doc.lastUsedAt = now
  await doc.save()
}

/**
 * Remove the GitHub OAuth account only (PAT entries are untouched).
 */
async function _removeOAuth(userId) {
  // Mongoose documents in this build are plain accessor objects (neither
  // `delete doc.field` nor `doc.unset` reliably trigger a removal), so use
  // a raw $update with $unset — version-proof.
  await GitHubSyncUserCredentials.updateOne(
    normalizeQuery({ userId }),
    { $unset: { github: 1 }, $set: { lastUsedAt: new Date() } }
  )
}

/** Resolve the token for an OAuth-slot account (used by resolveCreds paths). */
async function getOAuthToken(userId, username) {
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  const tokenEncrypted = oauthSlotToken(credentials)
  if (!tokenEncrypted) {
    throw new InvalidTokenError('no github oauth token', { userId, status: 400 })
  }
  const linked = await getOAuth(userId)
  if (username && linked.username && username !== linked.username) {
    throw new InvalidTokenError(
      `github oauth account is '${linked.username}', not '${username}'`,
      { userId, status: 400 }
    )
  }
  return decryptAccessToken(tokenEncrypted)
}

/**
 * Does (provider, url) have a usable account — PAT entry or (for github.com)
 * the OAuth slot?
 */
async function hasAccount(userId, provider, serverUrl) {
  const normalizedServerUrl = (serverUrl || '').replace(/\/$/, '')
  if (normalizedServerUrl) {
    try {
      await getUserPAT(userId, provider, normalizedServerUrl)
      return true
    } catch {
      // fall through to the OAuth slot
    }
  }
  if (provider === 'github' &&
      (!normalizedServerUrl || normalizedServerUrl === getDefaultServerUrl('github'))) {
    const linked = await getOAuth(userId)
    if (linked.linked) return true
  }
  throw new InvalidTokenError(
    `no git account for ${provider} ${normalizedServerUrl || '(default)'}`,
    { userId, provider, serverUrl: normalizedServerUrl, status: 400 }
  )
}

// ------------------------- Legacy single-token API -------------------------- //

async function getUserToken(userId) {
  // Order: OAuth slot first (it is the dedicated github account), then the
  // github.com PAT entries, then the pre-schema legacy string.
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) {
    throw new InvalidTokenError('no user token', { userId, status: 400 })
  }

  const slotToken = oauthSlotToken(credentials)
  if (slotToken) {
    return await decryptAccessToken(slotToken)
  }

  const defaultUrl = getDefaultServerUrl('github')
  try {
    return await getUserPAT(userId, 'github', defaultUrl)
  } catch (err) {
    if (!(err instanceof InvalidTokenError || err?.status === 400) || !credentials) {
      throw err
    }
    const legacy = credentials.github
    if (typeof legacy === 'string') {
      return await decryptAccessToken(legacy)
    }
    throw err
  }
}

async function saveUserToken(userId, accessToken, serverTypeOrServerUrl) {
  let provider = 'github'
  let serverUrl = getDefaultServerUrl('github')

  if (typeof serverTypeOrServerUrl === 'string' && validProviders.includes(serverTypeOrServerUrl)) {
    provider = serverTypeOrServerUrl
    serverUrl = getDefaultServerUrl(provider)
  } else if (typeof serverTypeOrServerUrl === 'string') {
    serverUrl = serverTypeOrServerUrl
  }

  // The OAuth slot is the github.com account; other providers fall back to
  // PAT-style storage under an anonymous account.
  if (provider === 'github' && serverUrl.replace(/\/$/, '') === getDefaultServerUrl('github')) {
    return _saveOAuth(userId, accessToken, '')
  }
  return _saveUserPAT(userId, provider, serverUrl, '', accessToken)
}

async function removeUserToken(userId) {
  // H10: only ever removes the GitHub OAuth slot — never a PAT entry, never
  // another provider (the old clearAll footgun is gone).
  await _removeOAuth(userId)
  logger.debug({ userId }, 'removed github oauth slot from user credentials')
}

// ------------------------- exports -------------------------- //
async function saveUserPAT(userId, provider, serverUrl, username, pat) {
  return withUserLock(userId, () => _saveUserPAT(userId, provider, serverUrl, username, pat))
}
async function addServerConfig(userId, provider, serverUrl, username) {
  return withUserLock(userId, () => _addServerConfig(userId, provider, serverUrl, username))
}
async function removeServer(userId, provider, serverUrl, username) {
  return withUserLock(userId, () => _removeUserPAT(userId, provider, serverUrl, username))
}
async function removeUserPAT(userId, provider, serverUrl, username) {
  return withUserLock(userId, () => _removeUserPAT(userId, provider, serverUrl, username))
}

export default {
  saveUserPAT,
  getUserPAT,
  getUserPATCredentials,
  getPublicServers,
  getLinkedServers,
  hasAccount,
  removeUserPAT,
  addServerConfig,
  removeServer,
  getUserServers,

  // GitHub OAuth slot (dedicated account, coexists with PAT entries)
  getOAuth,
  saveOAuth: (userId, token, username) =>
    withUserLock(userId, () => _saveOAuth(userId, token, username)),
  removeOAuth: (userId) => withUserLock(userId, () => _removeOAuth(userId)),
  getOAuthToken,

  // Legacy single-token API (kept for backward compatibility)
  saveUserToken,
  getUserToken,
  removeUserToken
}
