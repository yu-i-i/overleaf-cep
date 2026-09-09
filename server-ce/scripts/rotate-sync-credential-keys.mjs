/**
 * One-time key-rotation migration for sync-credential collections (plan P0-3).
 *
 * Re-encrypts stored provider credentials from the OLD cipher key to the NEW
 * one, after the deployment env has moved to the new key:
 *   - WebDAV user credentials  (labelled AccessTokenEncryptor v3 format:
 *     "<label>:<saltHex>:<cipherB64>:<ivHex>", HKDF-SHA512, aes-256-ctr)
 *   - Dropbox access tokens  (aes-256-gcm, key = SHA-256("overleaf-dropbox-credentials-v2|<pw>"))
 *   - GitHub-sync PATs       (same scheme/format as WebDAV; key from
 *     GITHUB_TOKEN_CIPHER_PASSWORD env or /var/lib/overleaf/data/.token-cipher.json)
 *
 * SAFETY:
 *   - DRY-RUN by default (decode/verify only, no writes). Pass --apply to write.
 *   - Verifies every decrypted plaintext round-trips before writing.
 *   - Backs up every touched document to a JSON file (path printed) before write.
 *   - Idempotent: documents already under the NEW label/key are skipped.
 *
 * Usage (from the host):
 *   docker cp server-ce/scripts/rotate-sync-credential-keys.mjs overleafserver:/tmp/
 *   docker exec \
 *     -e OLD_CYPHER_PASSWORD='generate-a-long-random-secret' \
 *     -e OLD_CYPHER_LABEL='OL_WEBDAV-v3' \
 *     -e NEW_CYPHER_PASSWORD='<strong-random>' \
 *     -e NEW_CYPHER_LABEL='OL_WEBDAV-v4' \
 *     overleafserver node /tmp/rotate-sync-credential-keys.mjs            # dry-run
 *   docker exec ... overleafserver node /tmp/rotate-sync-credential-keys.mjs --apply
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
// Resolved through the app's own node_modules (same as the web process).
const require = createRequire('/overleaf/package.json')
const { MongoClient } = require('mongodb')

const APPLY = process.argv.includes('--apply')
const MONGO_URL = process.env.OVERLEAF_MONGO_URL || 'mongodb://overleafmongo/sharelatex'
const OLD_PW = process.env.OLD_CYPHER_PASSWORD || ''
const OLD_LABEL = process.env.OLD_CYPHER_LABEL || 'OL_WEBDAV-v3'
const NEW_PW = process.env.NEW_CYPHER_PASSWORD || ''
const NEW_LABEL = process.env.NEW_CYPHER_LABEL || 'OL_WEBDAV-wip'

const summary = { webdav: {}, dropbox: {}, github: {}, skipped: 0, errors: [] }

if (!OLD_PW || !NEW_PW || !NEW_LABEL) {
  console.error('ERROR: set OLD_CYPHER_PASSWORD, NEW_CYPHER_PASSWORD, NEW_CYPHER_LABEL')
  process.exit(2)
}
if (OLD_LABEL === NEW_LABEL) {
  console.error('ERROR: labels must differ')
  process.exit(2)
}

// --- AccessTokenEncryptor "v3" scheme (mirror of libraries/access-token-encryptor) ---
const hkdf = (password, salt) =>
  crypto.hkdfSync('sha512', password, salt, '', 32)
const aesCtrEncrypt = (json, password) => {
  const bytes = crypto.randomBytes(32)
  const salt = bytes.subarray(0, 16)
  const iv = bytes.subarray(16, 32)
  const key = hkdf(password, salt)
  const c = crypto.createCipheriv('aes-256-ctr', key, iv)
  const ct = c.update(JSON.stringify(json), 'utf8', 'base64') + c.final('base64')
  return { salt, iv, ct }
}
const v3Decrypt = (str, password) => {
  const [label, saltHex, ct, ivHex] = str.split(':', 4)
  const key = hkdf(password, Buffer.from(saltHex, 'hex'))
  const d = crypto.createDecipheriv('aes-256-ctr', key, Buffer.from(ivHex, 'hex'))
  return JSON.parse(d.update(ct, 'base64', 'utf8') + d.final('utf8'))
}
const v3EncryptWithLabel = (json, password, label) => {
  const { salt, iv, ct } = aesCtrEncrypt(json, password)
  return `${label}:${salt.toString('hex')}:${ct}:${iv.toString('hex')}`
}

// --- Dropbox scheme (mirror of DropboxCredentials.mjs) ---
const dbxKey = pw =>
  crypto.createHash('sha256').update(`overleaf-dropbox-credentials-v2|${pw}`).digest()
const dbxDecrypt = (b64, pw) => {
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(-16)
  const ct = buf.subarray(12, -16)
  const d = crypto.createDecipheriv('aes-256-gcm', dbxKey(pw), iv)
  d.setAuthTag(tag)
  return d.update(ct, 'base64', 'utf8') + d.final('utf8')
}
const dbxEncrypt = (str, pw) => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', dbxKey(pw), iv)
  const ct = c.update(str, 'utf8', 'base64') + c.final('base64')
  return Buffer.concat([iv, Buffer.from(ct, 'base64'), c.getAuthTag()]).toString('base64')
}

try {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db()

  function matchCollections(native, pat) {
    const names = native.map(c => c.name)
    return names.filter(n => new RegExp(`^${pat}usercredentials$`, 'i').test(n))
  }

  const all = await db.listCollections().toArray()
  const colls = {
    webdav: matchCollections(all, 'webdav'),
    dropbox: matchCollections(all, 'dropbox'),
    github: matchCollections(all, 'githubsync'),
  }
  console.log('collections:', JSON.stringify(colls, null, 1))
  if (colls.webdav.length === 0) summary.errors.push('webdav credentials collection not found')
  if (colls.dropbox.length === 0) summary.errors.push('dropbox credentials collection not found')
  if (colls.github.length === 0) summary.errors.push('github credentials collection not found')
  if (!APPLY) console.log('DRY-RUN mode (no writes). Pass --apply to write.')
  else console.log('APPLY mode (writes enabled).')

  const backup = []
  const BACKUP_PATH = `/tmp/sync-creds-backup-${Date.now()}.json`
  // R2-fix: flush the (cumulative) backup after EACH collection, so a crash
  // mid-run still leaves a backup of everything already written.
  function flushBackup() {
    if (!APPLY) return
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2), { mode: 0o600 })
    if (backup.length) summary.backupFile = BACKUP_PATH
  }

  // ---- 1) WebDAV credentials (each matching collection) ----
  for (const cname of colls.webdav) {
    const c = db.collection(cname)
    const docs = await c.find({}).toArray()
    let nRewrite = 0, nAlreadyNew = 0, nFailOld = 0
    for (const doc of docs) {
      const enc = doc.credentials
      let plain = null
      let alreadyNew = false
      if (typeof enc !== 'string' || !enc) {
        nFailOld++; summary.errors.push(`webdav[${cname}] uid=${doc.userId}: credentials field missing/non-string — skipped`); continue
      }
      // App labels: the access-token-encryptor only accepts labels of the form
      // '<prefix>-v3' (single dash separator, version exactly 'v3').
      const storedLabel = enc.split(':', 1)[0]
      if (storedLabel === NEW_LABEL) alreadyNew = true
      if (!alreadyNew) {
        try { plain = v3Decrypt(enc, OLD_PW) }
        catch {
          try { plain = v3Decrypt(enc, NEW_PW) } catch { plain = null }
        }
        if (plain === null) {
          nFailOld++; summary.errors.push(`webdav[${cname}] uid=${doc.userId}: label='${storedLabel}' not decryptable with old/new key — skipped (manual review)`); continue
        }
        if (storedLabel !== OLD_LABEL) console.log(`note webdav[${cname}] uid=${doc.userId}: migrating label '${storedLabel}' -> '${NEW_LABEL}'`)
      }
      if (alreadyNew) { nAlreadyNew++; console.log(`ok   webdav[${cname}] uid=${doc.userId}: already-new`); continue }
      const reenc = v3EncryptWithLabel(plain, NEW_PW, NEW_LABEL)
      const verify = v3Decrypt(reenc, NEW_PW)
      if (verify.password !== plain.password) throw new Error('round-trip mismatch')
      console.log(`migr webdav[${cname}] uid=${doc.userId}: re-encrypted credentials (username=${plain.username ?? '?'} host=${plain.baseUrl ?? '?'})`)
      nRewrite++
      backup.push({ coll: cname, doc })
      if (APPLY) await c.updateOne({ _id: doc._id }, { $set: { credentials: reenc, rotatedAt: new Date() } })
    }
    summary.webdav[cname] = { total: docs.length, rewrote: nRewrite, alreadyNew: nAlreadyNew, failOld: nFailOld }
    flushBackup()
  }

  // ---- 2) Dropbox tokens ----
  for (const cname of colls.dropbox) {
    const c = db.collection(cname)
    const docs = await c.find({}).toArray()
    let nRewrite = 0, nFail = 0, nSkipUnknown = 0, nAlready = 0
    for (const doc of docs) {
      // field location varies across schema generations: accessToken (legacy)
      // or credentials (current); value may be raw-GCM base64 or a labelled
      // scheme the current build does not understand.
      const raw = doc.accessToken && typeof doc.accessToken === 'string'
        ? doc.accessToken
        : (doc.credentials && typeof doc.credentials === 'string' ? doc.credentials : null)
      const field = doc.accessToken ? 'accessToken' : 'credentials'
      if (!raw) { nSkipUnknown++; console.log(`skip dropbox[${cname}] uid=${doc.userId}: no token field (fields: ${Object.keys(doc).join(',')})`); continue }
      if (/^[A-Za-z0-9_-]+-v\d+:/.test(raw)) {
        nSkipUnknown++
        const msg = `dropbox[${cname}] uid=${doc.userId}: labelled token '${raw.split(':', 1)[0]}' — no reader/writer of this scheme exists in the current build (D5: development junk per user decision); NOT migrated, left untouched`
        console.log('skip ' + msg)
        summary.errors.push(msg)
        continue
      }
      let plain = null
      let outcome = ''
      try { plain = dbxDecrypt(raw, OLD_PW); outcome = 'decrypted-old' }
      catch {
        try { plain = dbxDecrypt(raw, NEW_PW); outcome = 'already-new' }
        catch { outcome = 'decrypt-failed' }
      }
      if (outcome === 'already-new') { nAlready++; console.log(`ok   dropbox[${cname}] uid=${doc.userId} (${field}): already-new`); continue }
      if (outcome === 'decrypt-failed') {
        nFail++
        const msg = `dropbox[${cname}] uid=${doc.userId} (${field}): decrypt failed with old+new+legacy keys — left untouched (manual review)`
        console.log('FAIL ' + msg)
        summary.errors.push(msg)
        continue
      }
      const reenc = dbxEncrypt(plain, NEW_PW)
      if (dbxDecrypt(reenc, NEW_PW) !== plain) throw new Error('round-trip mismatch')
      nRewrite++
      console.log(`migr dropbox[${cname}] uid=${doc.userId} (${field}): re-encrypted ${plain.length}b token (decrypted as ${JSON.stringify(plain.slice(0, 12))}...)`)
      backup.push({ coll: cname, doc })
      if (APPLY) await c.updateOne({ _id: doc._id }, { $set: { [field]: reenc, rotatedAt: new Date() } })
    }
    summary.dropbox[cname] = { total: docs.length, rewrote: nRewrite, alreadyNew: nAlready, fail: nFail, skippedUnknown: nSkipUnknown }
    flushBackup()
  }

  // ---- 3) GitHub-sync PATs ----
  // These use GITHUB_TOKEN_CIPHER_PASSWORD / token file — usually a random persistent
  // key, NOT the weak shared one. We only verify decryptability and rotate ONLY if
  // the stored label matches OLD_LABEL (i.e. it shared the weak key).
  const ghColls = colls.github
  if (ghColls.length) {
    const fileKeyPw = (() => {
      try {
        const j = JSON.parse(fs.readFileSync('/var/lib/overleaf/data/.token-cipher.json', 'utf8'))
        return j.cipherPasswords?.[j.cipherLabel] || ''
      } catch { return '' }
    })()
    const githubPw = process.env.GITHUB_TOKEN_CIPHER_PASSWORD || fileKeyPw
    for (const cname of ghColls) {
      const c = db.collection(cname)
      const docs = await c.find({}).toArray()
      let nVerifyOk = 0, nVerifyFail = 0, nRotate = 0
      for (const doc of docs) {
        const providers = doc.tokens || {}
        let allOk = true
        let anyOldLabel = false
        Object.values(providers).forEach(byUrl => {
          Object.values(byUrl || {}).forEach(enc => {
            if (!enc) return
            const label = String(enc).split(':', 1)[0]
            if (label === OLD_LABEL) anyOldLabel = true
            const okKey = [NEW_PW, OLD_PW, githubPw].find(k => { try { v3Decrypt(enc, k); return true } catch { return false } })
            if (!okKey) allOk = false
          })
        })
        if (allOk) nVerifyOk++
        else { nVerifyFail++; summary.errors.push(`github[${cname}] uid=${doc.userId}: some tokens undecryptable`) }
        if (anyOldLabel && githubPw) {
          // R2-fix: the github encryptor label is INDEPENDENT of the webdav
          // cipher label — it is GITHUB_TOKEN_CIPHER_LABEL || TOKEN_CIPHER_LABEL
          // || 'OL_CEP-v3' (see AccessTokenEncryptorHelper). NEVER stamp NEW_LABEL.
          const label = process.env.GITHUB_TOKEN_CIPHER_LABEL ||
                        process.env.TOKEN_CIPHER_LABEL || 'OL_CEP-v3'
          const newTokens = {}
          for (const [prov, byUrl] of Object.entries(providers)) {
            newTokens[prov] = {}
            for (const [url, enc] of Object.entries(byUrl || {})) {
              newTokens[prov][url] = typeof enc === 'string' && enc.startsWith(`${OLD_LABEL}:`)
                ? v3EncryptWithLabel(v3Decrypt(enc, OLD_PW), githubPw, label) : enc
            }
          }
          nRotate++
          backup.push({ coll: cname, doc })
          if (APPLY) await c.updateOne({ _id: doc._id }, { $set: { tokens: newTokens, rotatedAt: new Date() } })
        } else if (anyOldLabel) {
          const msg = `github[${cname}] uid=${doc.userId}: tokens under OLD label present but NO github key available (set GITHUB_TOKEN_CIPHER_PASSWORD or the token-cipher file) — rotation skipped`
          console.error('SKIP: ' + msg)
          summary.errors.push(msg)
        }
      }
      summary.github[cname] = { total: docs.length, verifyOk: nVerifyOk, verifyFail: nVerifyFail, rotated: nRotate }
      flushBackup()
    }
  } else {
    summary.errors.push('github credentials collection not found (may be empty/disconnected)')
  }

  if (APPLY && backup.length) {
    flushBackup()
  }
  await client.close()
  console.log(JSON.stringify(summary, null, 2))
} catch (err) {
  console.error('MIGRATION FAILED:', err.message)
  summary.errors.push(err.message)
  process.exit(1)
}
