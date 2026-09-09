/**
 * Container boot: admin-managed site settings → process env (R9 §7.2/§7.4).
 *
 * Run by /etc/my_init.d/950_hydrate_site_settings_env.sh BEFORE the runit
 * services start, so every service (web, clsi, …) that sources
 * /etc/overleaf/env.sh sees stored admin values override compose env.
 * Prints `export KEY=VALUE` lines on stdout (the shell script appends
 * them between managed markers). No stored doc ⇒ no output.
 *
 * Self-contained on purpose: mongodb driver + the shared connection hub +
 * the site-settings secret cipher. Never throws to the shell (the script
 * tolerates failure — compose env then stands).
 */
import { db } from '../../../app/src/infrastructure/mongodb.mjs'
import { decryptText } from '../../../app/src/Features/SiteSettings/SecretCipher.mjs'

const b = (v) => (v ? 'true' : 'false')
const q = (v) => `"${String(v ?? '').replace(/(["\\$`'!])/g, '\\$1')}"`

async function section (name, secretFields = []) {
  let doc = null
  try {
    doc = await db.siteSettings.findOne({ _id: 'global' })
  } catch (err) {
    console.error('hydrate: site_settings read failed:', err.message)
    process.exitCode = 1
    return null
  }
  const stored = doc && doc[name]
  if (!stored || typeof stored !== 'object') return null
  for (const f of secretFields) {
    if (stored[f] && typeof stored[f] === 'string') {
      try {
        stored[f] = await decryptText(stored[f])
      } catch (err) {
        console.error(`hydrate: decrypt ${name}.${f} failed:`, err.message)
        stored[f] = ''
      }
    }
  }
  return stored
}

const lines = []
const add = (name, value) => {
  if (value === undefined || value === null || value === '') return
  lines.push(`export ${name}=${q(value)}`)
}

let sc = await section('sandboxed-compiles')
if (sc) {
  const images = Array.isArray(sc.images) ? sc.images : []
  const enabled = !!sc.enabled
  add('SANDBOXED_COMPILES', b(enabled))
  add('SANDBOXED_COMPILES_SIBLING_CONTAINERS', b(enabled))
  add('SIBLING_CONTAINERS_ENABLED', b(enabled || !!sc.dockerRunner))
  add('DOCKER_RUNNER', b(enabled || !!sc.dockerRunner))
  add('SANDBOXED_COMPILES_HOST_DIR', sc.hostDir)
  add('COMPILES_HOST_DIR', sc.hostDir)
  add('DOCKER_SOCKET_PATH', sc.socketPath)
  add('TEX_COMPILER_EXTRA_FLAGS', sc.extraFlags)
  add('TEXLIVE_IMAGE_USER', sc.imageUser)
  add('ALL_TEX_LIVE_DOCKER_IMAGES', images.map(r => r?.image).filter(Boolean).join(','))
  add(
    'ALL_TEX_LIVE_DOCKER_IMAGE_NAMES',
    images.map(r => (r?.name || r?.image || '').trim()).join(',')
  )
  add('TEX_LIVE_DOCKER_IMAGE', sc.defaultImage || (images[0] && images[0].image))
}

const git = await section('git-integration')
if (git) {
  add('GIT_BRIDGE_ENABLED', b(git.enabled))
  add('GIT_BRIDGE_HOST', git.host)
  add('GIT_BRIDGE_PORT', git.port)
}

const gh = await section('github-sync', ['clientSecret'])
if (gh) {
  add('GITHUB_SYNC_ENABLED', b(gh.enabled))
  add('GITHUB_SYNC_CLIENT_ID', gh.clientId || gh.clientID)
  add('GITHUB_SYNC_CLIENT_SECRET', gh.clientSecret)
  add('GITHUB_TOKEN_CIPHER_FILE', gh.cipherFile)
  add('GITHUB_TOKEN_CIPHER_LABEL', gh.cipherLabel)
}

const email = await section('email', ['pass', 'sesSecret'])
if (email) {
  add('EMAIL_CONFIRMATION_DISABLED', b(email.skipConfirmation))
  // CE's Settings email block reads LONG OVERLEAF_EMAIL_* names
  // (server-ce/config/settings.js) — emit those (2026-08-30).
  add('OVERLEAF_EMAIL_FROM_ADDRESS', email.fromAddress)
  add('OVERLEAF_EMAIL_REPLY_TO', email.replyTo)
  add('OVERLEAF_EMAIL_DRIVER', email.driver || 'smtp')
  add('OVERLEAF_EMAIL_SMTP_HOST', email.host)
  add('OVERLEAF_EMAIL_SMTP_PORT', email.port)
  add('OVERLEAF_EMAIL_SMTP_SECURE', b(email.secure))
  add('OVERLEAF_EMAIL_SMTP_IGNORE_TLS', b(email.ignoreTLS))
  add('OVERLEAF_EMAIL_SMTP_NAME', email.name)
  add('OVERLEAF_EMAIL_SMTP_USER', email.user)
  add('OVERLEAF_EMAIL_SMTP_PASS', email.pass)
  add('OVERLEAF_EMAIL_AWS_SES_ACCESS_KEY_ID', email.accessKeyId)
  add('OVERLEAF_EMAIL_AWS_SES_SECRET_KEY', email.sesSecret)
  add('OVERLEAF_EMAIL_AWS_SES_REGION', email.sesRegion)
}

const lft = await section('linked-file-types')
if (lft) {
  const types = Array.isArray(lft.enabledTypes) ? lft.enabledTypes : []
  const merged = ['project_file', 'project_output_file']
  for (const t of types) if (!merged.includes(t)) merged.push(t)
  add('ENABLED_LINKED_FILE_TYPES', merged.join(','))
}

const pandoc = await section('pandoc')
if (pandoc) {
  add('ENABLE_PANDOC_CONVERSIONS', b(pandoc.enabled))
  add('PANDOC_IMAGE', pandoc.image)
}

for (const line of lines) console.log(line)

// The shared mongodb connection keeps the event loop alive — the my_init
// script expects this node process to terminate after printing.
process.exit(process.exitCode || 0)
