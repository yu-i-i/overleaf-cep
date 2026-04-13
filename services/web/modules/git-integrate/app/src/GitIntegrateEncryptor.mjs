/**
 * Token encryption helper for git-integrate.
 *
 * Adapted from services/web/modules/zotero/app/src/AccessTokenEncryptorHelper.mjs
 * (same pattern: file-backed key in the persistent data volume, or an explicit
 * environment variable for operators who prefer external secrets management).
 *
 * The cipher key is stored at /var/lib/overleaf/data/.git-integrate-cipher-key
 * the first time the module starts and never rotates automatically.  An operator
 * can force rotation by deleting the key file and re-deploying (all stored tokens
 * will be invalidated and users will need to reconnect).
 */

import AccessTokenEncryptorClass from '@overleaf/access-token-encryptor'
import fs from 'node:fs'
import crypto from 'node:crypto'
import Path from 'node:path'

const CIPHER_KEY_FILE =
    '/var/lib/overleaf/data/.git-integrate-cipher-key'
const DEFAULT_CIPHER_LABEL = '2024.1-v3'

let _encryptorInstance = null

function _getStableCipherPassword() {
    if (process.env.GIT_INTEGRATE_CIPHER_PASSWORD) {
        return process.env.GIT_INTEGRATE_CIPHER_PASSWORD
    }
    try {
        const existing = fs.readFileSync(CIPHER_KEY_FILE, 'utf8').trim()
        if (existing.length >= 16) return existing
    } catch {
        // Key file not yet created — generate one below.
    }
    const newKey = crypto.randomBytes(32).toString('base64')
    const dir = Path.dirname(CIPHER_KEY_FILE)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CIPHER_KEY_FILE, newKey, { mode: 0o600 })
    return newKey
}

function _getEncryptor() {
    if (!_encryptorInstance) {
        const cipherLabel =
            process.env.GIT_INTEGRATE_CIPHER_LABEL || DEFAULT_CIPHER_LABEL
        const cipherPassword = _getStableCipherPassword()
        _encryptorInstance = new AccessTokenEncryptorClass({
            cipherLabel,
            cipherPasswords: { [cipherLabel]: cipherPassword },
        })
    }
    return _encryptorInstance
}

export const GitIntegrateEncryptor = {
    promises: {
        /** @param {object} json */
        async encryptJson(json) {
            return _getEncryptor().promises.encryptJson(json)
        },
        /** @param {string} encryptedJson */
        async decryptToJson(encryptedJson) {
            return _getEncryptor().promises.decryptToJson(encryptedJson)
        },
    },
}
