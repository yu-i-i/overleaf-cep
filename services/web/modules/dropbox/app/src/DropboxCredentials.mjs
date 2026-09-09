/**
 * Dropbox Token Encryption/Decryption
 *
 * Uses the same encryption scheme as WebDAV module to maintain consistency.
 * Adapted from WebdavTokenEncryption for use with OAuth 2.0 access tokens.
 */

import { createCipheriv, createDecipheriv, randomFillSync, createHash } from 'node:crypto'
import logger from '@overleaf/logger'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

/**
 * Get encryption key (DBX-07): derived with SHA-256 from a real secret.
 * Preference: WEBDAV_TOKEN_CIPHER_PASSWORD (shared with the WebDAV module),
 * then Overleaf's SECRET_TOKEN. Never falls back to a deterministic
 * NODE_ENV-based key — that made all deployments share the same cipher key.
 */
function deriveKey(secret, purpose) {
  return createHash('sha256').update(`${purpose}|${secret}`).digest()
}

export function getEncryptionKey() {
  const password = process.env.WEBDAV_TOKEN_CIPHER_PASSWORD
  if (password) {
    if (password.length < 16) {
      logger.warn('WEBDAV_TOKEN_CIPHER_PASSWORD should be at least 16 characters for security')
    }
    return deriveKey(password, 'overleaf-dropbox-credentials-v2')
  }

  const secretToken = process.env.SECRET_TOKEN
  if (secretToken) {
    logger.warn(
      'WEBDAV_TOKEN_CIPHER_PASSWORD not set; using SECRET_TOKEN to derive the Dropbox credential key'
    )
    return deriveKey(secretToken, 'overleaf-dropbox-credentials-secret-token-fallback')
  }

  logger.error(
    'Neither WEBDAV_TOKEN_CIPHER_PASSWORD nor SECRET_TOKEN is set; Dropbox credential encryption is disabled'
  )
  throw new Error(
    'No encryption secret available for Dropbox credentials (set WEBDAV_TOKEN_CIPHER_PASSWORD or SECRET_TOKEN)'
  )
}

/**
 * Legacy key from the pre-fix implementation (deterministic NODE_ENV string,
 * kept ONLY so tokens encrypted by old deployments can still be decrypted).
 * New tokens are never written with this key.
 */
function legacyNodeEnvKey() {
  const envString = process.env.NODE_ENV || 'development'
  return Buffer.from(`overleaf-dropbox-credentials-v2|${envString}`.padEnd(32, 'x').slice(0, 32), 'utf8')
}

function legacyRawKey() {
  const envString = process.env.NODE_ENV || 'development'
  return Buffer.from(envString.padEnd(32, 'x').slice(0, 32), 'utf8')
}

/**
 * Encrypt token using AES-256-GCM
 */
export function encryptToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token for encryption')
  }

  const key = getEncryptionKey()
  const iv = Buffer.alloc(IV_LENGTH)
  randomFillSync(iv)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(token, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  // Get authentication tag
  const authTag = cipher.getAuthTag()

  // Combine iv + encrypted + tag
  return Buffer.concat([iv, Buffer.from(encrypted, 'base64'), authTag]).toString('base64')
}

/**
 * Decrypt token using AES-256-GCM. Tries the current key first, then the
 * legacy (pre-fix) key so tokens from older deployments keep working.
 */
export function decryptToken(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('Invalid encrypted data for decryption')
  }

  const buffer = Buffer.from(encryptedData, 'base64')

  // Extract parts
  const iv = buffer.subarray(0, IV_LENGTH)
  const authTag = buffer.subarray(-TAG_LENGTH)
  const encryptedContent = buffer.subarray(IV_LENGTH, -TAG_LENGTH)

  if (iv.length !== IV_LENGTH || authTag.length !== TAG_LENGTH) {
    throw new Error('Invalid encrypted data format')
  }

  const keyCandidates = []
  try {
    keyCandidates.push(getEncryptionKey())
  } catch (keyErr) {
    // Current key unavailable; continue to legacy candidates
  }
  keyCandidates.push(legacyNodeEnvKey(), legacyRawKey())

  let lastError
  for (const key of keyCandidates) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encryptedContent, 'base64', 'utf8')
      decrypted += decipher.final('utf8')

      if (key !== keyCandidates[0]) {
        logger.warn('Decrypted Dropbox token with a LEGACY key; it should be re-encrypted with the current key')
      }
      return decrypted
    } catch (error) {
      lastError = error
    }
  }

  logger.error({ err: lastError }, 'Token decryption failed with all key candidates')
  throw new Error('Decryption failed. Invalid token or encryption key.')
}

/**
 * Validate encrypted data format
 */
export function isValidEncryptedData(data) {
  if (!data || typeof data !== 'string') return false

  try {
    const buffer = Buffer.from(data, 'base64')
    return buffer.length >= IV_LENGTH + TAG_LENGTH
  } catch {
    return false
  }
}

export default {
  encryptToken,
  decryptToken,
  isValidEncryptedData,
}
