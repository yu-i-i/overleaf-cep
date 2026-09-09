/**
 * SiteSettings — admin-managed site configuration backed by MongoDB.
 *
 * One document per site
 * `{ _id: 'global', templates: {...}, zotero: {...}, externalUrl: {...},
 * signup: {...}, updatedAt }` in the `site_settings` collection.
 *
 * Semantics (BIB_ORCID_TEMPLATES_PLAN.md decision 3.0):
 *  - STORED value wins over environment; env values are SEEDS (used
 *    only while the stored document/field is missing).
 *  - Values are read PER REQUEST (the web app runs multiple workers —
 *    no process-local truth); a short TTL cache avoids hammering mongo
 *    while keeping admin saves visible across workers within a few
 *    seconds.
 *  - Secrets (e.g. the Zotero client secret) are stored ENCRYPTED
 *    (AES-256-GCM via ./SecretCipher.mjs — the same cipher file as the
 *    zotero & github-sync token ciphers), never returned in plaintext
 *    (masked via maskSecrets), and a stored value always beats the env
 *    value once set.
 *
 * NOTE: `coreSettings` (the resolved `@overleaf/settings` object) is
 * passed in at the call sites that hold it (routers/controllers) so this
 * feature does not import the settings singleton directly.
 */
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { encryptText, decryptText } from './SecretCipher.mjs'

const SECTION_ID = 'global'
const CACHE_TTL_MS = 5_000

// ---------------------------------------------------------------------------
// 2026-08-31 (P0 tripwire): site_settings is LIVE SITE STATE. Unit tests
// must never read/write the production database. The vitest worker is
// SHARED (isolate: false) and ESM static imports are hoisted, so a test
// file's own `process.env.MONGO_URL = ...` line does NOT reliably guard
// the `@overleaf/settings` singleton; once it resolves Settings.mongo.url
// with the production default (mongodb://.../sharelatex) every later
// manager call in that worker hits the LIVE database. This actually
// destroyed the dev site's stored settings on 2026-08-30/31. Fail loudly.
// ---------------------------------------------------------------------------
function assertNotLiveDbInTests () {
  const inVitest = !!(
    process.env.VITEST_WORKER_ID ||
    process.env.__VITEST_WORKER_ID ||
    process.env.VITEST === 'true'
  )
  if (!inVitest) return
  let dbName = ''
  try {
    const url = String(Settings.mongo.url || '')
    // mongodb://127.0.0.1:27017/overleaf-unit-test  ->  last path segment
    const segments = url.split('/').filter(Boolean)
    dbName = segments.length ? segments[segments.length - 1] : ''
  } catch (err) {
    return // Settings not available in this context: nothing to check
  }
  if (dbName === 'sharelatex') {
    const err = new Error('FATAL (test tripwire): a unit-test process is bound to the LIVE sharelatex database. Set MONGO_URL to a unit database BEFORE any web-stack import (test/unit/unit-env.mjs). Refusing to touch live site settings.')
    err.liveDbTripwire = true
    throw err
  }
}

/**
 * Lazy collection access: importing the raw-connection hub at module
 * load time has side effects (Mongoose connect) that some test
 * environments do not tolerate; the server context always has it.
 */
async function getCollection() {
  assertNotLiveDbInTests()
  try {
    // eslint-disable-next-line prefer-const
    let dbModule
    try {
      dbModule = await import('../../infrastructure/mongodb.mjs')
    } catch (err) {
      logger.warn({ err }, 'SiteSettings: raw db unavailable')
      return null
    }
    return dbModule.db.siteSettings
  } catch (err) {
    logger.warn({ err }, 'SiteSettings: site_settings collection unavailable')
    return null
  }
}

/** In-section field names that hold encrypted values. */
export const SECRET_FIELDS = {
  zotero: ['clientSecret'],
  // SSO providers (SSO multi-provider, 2026-08-29): stored (encrypted)
  // wins over the OVERLEAF_* env seed under the same key.
  'sso-saml': ['idpCert', 'privateKey', 'decryptionPvk'],
  'sso-oidc': ['clientSecret'],
  'sso-ldap': ['bindCredentials'],
  // R9 (2026-08-29): six new admin-managed sections.
  'github-sync': ['clientSecret'],
  email: ['pass', 'sesSecret'],
}

let _cache = { at: 0, doc: undefined }
let _inflight = null

function now() {
  return Date.now()
}

function loadDoc() {
  if (now() - _cache.at < CACHE_TTL_MS && _cache.doc !== undefined) {
    return Promise.resolve(_cache.doc)
  }
  if (!_inflight) {
    _inflight = getCollection()
      .then(siteSettings =>
        siteSettings
          ? siteSettings.findOne({ _id: SECTION_ID })
          : Promise.resolve(null)
      )
      .then(doc => {
        _cache = { at: now(), doc: doc || null }
        _inflight = null
        return _cache.doc
      })
      .catch(err => {
        // The live-DB test tripwire must never be swallowed into env seeds.
        if (err && err.liveDbTripwire) {
          _inflight = null
          throw err
        }
        // Read failures degrade to env seeds; the failure is not cached.
        logger.warn({ err }, 'SiteSettings: load failed, using env seeds')
        _inflight = null
        return null
      })
  }
  return _inflight
}

// 2026-08-30: allow-list of stored section keys. setSection's validator
// (and this cleanup) use it so round-tripping a GET response (which
// carries derived "<field>Set" flags) back into a PUT does not 422 on
// "unknown key" (live bug, sso-reenable probe).
export const SECTION_KNOWN_KEYS = {
  templates: ['enabled', 'categories', 'allUsersCanManageTemplates'],
  zotero: ['enabled', 'clientKey', 'clientSecret'],
  externalUrl: ['enabled', 'blockedNetworks', 'allowedResourcesRegex'],
  signup: ['enabled', 'allowedEmailDomains', 'disabledRedirectUrl'],
  'sso-saml': [
    'enabled',
    'identityServiceName',
    'issuer',
    'entryPoint',
    'audience',
    'callbackURL',
    'idpCert',
    'privateKey',
    'decryptionPvk',
    'wantAssertionsSigned',
  ],
  'sso-oidc': [
    'enabled',
    'identityServiceName',
    'issuer',
    'authorizationURL',
    'tokenURL',
    'userInfoURL',
    'clientID',
    'clientSecret',
    'scope',
    'logoutURL',
  ],
  'sso-ldap': [
    'enabled',
    'identityServiceName',
    'url',
    'searchBase',
    'bindDN',
    'bindCredentials',
    'searchFilter',
    'searchScope',
    'placeholder',
    'emailAtt',
    'firstNameAtt',
    'lastNameAtt',
    'isAdminAtt',
    'updateUserDetailsOnLogin',
  ],
  'sandboxed-compiles': [
    'enabled',
    'dockerRunner',
    'hostDir',
    'socketPath',
    'extraFlags',
    'imageUser',
    'defaultImage',
    'images',
    'names',
  ],
  'git-integration': ['enabled', 'host', 'port'],
  'github-sync': [
    'enabled',
    'clientId',
    'clientID',
    'clientSecret',
    'cipherFile',
    'cipherLabel',
  ],
  email: [
    'driver',
    'host',
    'port',
    'secure',
    'user',
    'pass',
    'fromAddress',
    'skipConfirmation',
    'sesRegion',
    'sesSecret',
  ],
  'linked-file-types': ['enabledTypes'],
  pandoc: ['enabled', 'image'],
  misc: [
    'appName',
    'navHidePoweredBy',
    'robotsNoindex',
    'allowPublicAccess',
    'allowAnonymousReadWriteSharing',
    'disableLinkSharing',
    'disableChat',
    'projectHardDeletionDelayDays',
    'userHardDeletionDelayDays',
    'historyRestore',
    'enablePdfCaching',
    'maxUploadSizeMiB',
    'maxEntitiesPerProject',
    'defaultLatexCompiler',
  ],
}

export function cleanSectionInput (name, value) {
  const allowed = SECTION_KNOWN_KEYS[name]
  if (!allowed || !value || typeof value !== 'object') return value
  const allow = new Set(allowed)
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => allow.has(k))
  )
}

export function invalidateCache() {
  _cache = { at: 0, doc: undefined }
}

/**
 * Read ONLY the stored (admin-saved) copy of a section, with secret
 * fields decrypted — no env seeds. `null` when the admin has never saved
 * the section. Used by the boot env-hydrator so stored admin values can
 * override the process env BEFORE Settings consumers load.
 */
export async function readStoredSection(name) {
  const doc = await loadDoc()
  const stored = doc && doc[name]
  if (!stored || typeof stored !== 'object') return null
  const out = cloneDeep(stored)
  for (const field of SECRET_FIELDS[name] || []) {
    if (typeof out[field] === 'string' && out[field].length > 0) {
      try {
        out[field] = await decryptText(out[field])
      } catch (err) {
        logger.warn({ err, section: name, field }, 'SiteSettings: stored secret decrypt failed at read')
        out[field] = ''
      }
    }
  }
  return out
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value))
}

/** Mask encrypted secret fields for read-only API/UI surfaces. */
export function maskSecrets(sectionName, sectionValue) {
  const out = cloneDeep(sectionValue || {})
  for (const field of SECRET_FIELDS[sectionName] || []) {
    const hasValue = typeof out[field] === 'string' && out[field].length > 0
    out[`${field}Set`] = hasValue
    out[field] = ''
  }
  return out
}

/** The manual's 12 example categories (+ 'all') — defaults & seed names. */
export const DEFAULT_TEMPLATE_CATEGORIES = [
  {
    key: 'academic-journal',
    name: 'Academic journals',
    description: 'Templates for writing academic journal articles.',
  },
  {
    key: 'book',
    name: 'Books',
    description: 'Templates for writing books and book chapters.',
  },
  {
    key: 'presentation',
    name: 'Presentations',
    description: 'Templates for creating slide decks and presentations.',
  },
  {
    key: 'poster',
    name: 'Posters',
    description: 'Templates for conference and research posters.',
  },
  {
    key: 'cv',
    name: 'CVs',
    description: 'Templates for writing curricula vitae and résumés.',
  },
  {
    key: 'homework',
    name: 'Homework',
    description: 'Templates for student assignments and homework.',
  },
  {
    key: 'bibliography',
    name: 'Bibliographies',
    description: 'Templates for managing and formatting bibliography.',
  },
  {
    key: 'calendar',
    name: 'Calendars',
    description: 'Templates for printable and digital calendars.',
  },
  {
    key: 'formal-letter',
    name: 'Formal letters',
    description: 'Templates for writing formal and business letters.',
  },
  {
    key: 'report',
    name: 'Reports',
    description: 'Templates for business, lab and project reports.',
  },
  {
    key: 'thesis',
    name: 'Theses',
    description:
      'Templates for writing theses and dissertations, following institutional formatting and citation guidelines.',
  },
  {
    key: 'newsletter',
    name: 'Newsletters',
    description: 'Templates for creating newsletters and bulletins.',
  },
]

function boolFromEnv(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

// Deletion-delay env vars are milliseconds; the admin UI uses days.
function delayDaysFromMs(env, name, defaultDays) {
  const raw = env[name]
  if (raw) {
    const ms = parseInt(raw, 10)
    if (Number.isFinite(ms) && ms > 0) {
      const days = Math.round(ms / (24 * 60 * 60 * 1000))
      if (days > 0) return days
    }
  }
  return defaultDays
}


function seedTemplateCategories(env, stored) {
  // Union (user round 4, 2026-08-28): the table must list ALL categories
  // the template extension supports — the 12 manual defaults, whatever
  // OVERLEAF_TEMPLATE_CATEGORIES adds, custom stored keys (merged in by
  // getSection), and 'all'. Env still wins for per-key name/description.
  const keysRaw = env.OVERLEAF_TEMPLATE_CATEGORIES
  const envKeys = keysRaw ? keysRaw.split(/\s+/).filter(Boolean) : []
  const keys = []
  const push = (k) => { if (k && !keys.includes(k)) keys.push(k) }
  for (const key of [...DEFAULT_TEMPLATE_CATEGORIES.map(c => c.key), ...envKeys]) push(key)
  push('all')

  return keys.map((key) => {
    const envKeyBase = key.toUpperCase().replace(/-/g, '_')
    const def = DEFAULT_TEMPLATE_CATEGORIES.find(c => c.key === key)
    const s = (stored && stored.categories) || {}
    const storedCat = s[key] || {}
    return {
      key,
      enabled: storedCat.enabled !== false,
      name:
        env[`TEMPLATE_${envKeyBase}_NAME`] ||
        storedCat.name ||
        def?.name ||
        (key === 'all' ? 'All templates' : key),
      description:
        env[`TEMPLATE_${envKeyBase}_DESCRIPTION`] ||
        storedCat.description ||
        def?.description ||
        '',
      publishable: storedCat.publishable !== false,
    }
  })
}

/**
 * Per-section env seeds (evaluated per read; env is the fallback layer
 * under the stored document).
 */
function envSeeds(env, coreSettings, stored) {
  return {
    templates: {
      enabled:
        boolFromEnv(env.OVERLEAF_TEMPLATE_GALLERY) ??
        coreSettings?.templates?.enabled === true,
      categories: seedTemplateCategories(env, stored),
      // R6 (2026-08-29): "All users are template gallery admins" (site
      // setting, admin console). Stored true overrides this false seed.
      allUsersCanManageTemplates: false,
    },
    zotero: {
      enabled:
        boolFromEnv(env.OVERLEAF_ZOTERO) ??
        coreSettings?.enabledLinkedFileTypes?.includes('zotero'),
      clientKey: env.ZOTERO_CLIENT_KEY || '',
      hasEnvSecret: Boolean(env.ZOTERO_CLIENT_SECRET),
    },
    externalUrl: {
      enabled:
        boolFromEnv(env.OVERLEAF_EXTERNAL_URLS) ??
        coreSettings?.enabledLinkedFileTypes?.includes('url'),
      blockedNetworks: [
        '127.0.0.0/8',
        '169.254.0.0/16',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '::1/128',
        'fe80::/10',
        'fc00::/7',
      ],
      allowedResourcesRegex: env.OVERLEAF_LINKED_URL_ALLOWED_RESOURCES || '',
    },
    signup: {
      enabled:
        boolFromEnv(env.OVERLEAF_ENABLE_REGISTRATION_PAGE) ??
        !(coreSettings?.ldap?.enable ||
          coreSettings?.saml?.enable ||
          coreSettings?.oidc?.enable),
      allowedEmailDomains: (env.OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS || '')
        .split(/[,\s]+/)
        .filter(Boolean),
      // New 1: where /register sends visitors when the sign-up page is
      // disabled; empty/'' → the default /login.
      disabledRedirectUrl: env.OVERLEAF_REGISTRATION_DISABLED_REDIRECT || '',
    },
    // SSO providers are admin-managed and stored-only (D7: no env
    // fallback — an unset section means the provider is disabled).
    'sso-saml': { enabled: false },
    'sso-oidc': { enabled: false },
    'sso-ldap': { enabled: false },

    // R9 (2026-08-29): runtime sections that replace compose env.
    // Stored values (admin console) WIN over these env seeds; the env
    // lines are stripped from compose after migration (plan §7.4).
    'sandboxed-compiles': {
      enabled: boolFromEnv(env.SANDBOXED_COMPILES) === true,
      dockerRunner: boolFromEnv(env.DOCKER_RUNNER) === true,
      hostDir: env.SANDBOXED_COMPILES_HOST_DIR || env.COMPILES_HOST_DIR || '',
      socketPath: env.DOCKER_SOCKET_PATH || '',
      extraFlags: env.TEX_COMPILER_EXTRA_FLAGS || '',
      imageUser: env.TEXLIVE_IMAGE_USER || '',
      images: (() => {
        const list = String(env.ALL_TEX_LIVE_DOCKER_IMAGES || '')
          .split(',').map(x => x.trim()).filter(Boolean)
        const names = String(env.ALL_TEX_LIVE_DOCKER_IMAGE_NAMES || '')
          .split(',').map(x => x.trim())
        if (list.length > 0) {
          return list.map((image, i) => ({ image, name: names[i] || '' }))
        }
        // R12-1 (2026-08-31): last-resort seed — when neither stored values
        // nor env provide images, the sandbox tab used to render an EMPTY
        // table whose Save then 422s ("images must be a non-empty array").
        // Fall back to the canonical CE+ TeXLive set so the tab is always
        // usable (admin can still edit before saving).
        return [
          { image: 'texlive/texlive:latest-full', name: 'TeXLive 2025' },
          { image: 'texlive/texlive:TL2024-historic', name: 'TeXLive 2024' },
          { image: 'texlive/texlive:TL2023-historic', name: 'TeXLive 2023' },
        ]
      })(),
      defaultImage:
        env.TEX_LIVE_DOCKER_IMAGE || 'texlive/texlive:latest-full',
    },
    'git-integration': {
      enabled: boolFromEnv(env.GIT_BRIDGE_ENABLED) === true,
      host: env.GIT_BRIDGE_HOST || 'git-bridge',
      port: Number(env.GIT_BRIDGE_PORT) > 0 ? Number(env.GIT_BRIDGE_PORT) : 8000,
    },
    'github-sync': {
      enabled: boolFromEnv(env.GITHUB_SYNC_ENABLED) === true,
      // NOTE: key is 'clientId' (lowercase d) — matches the admin UI state,
      // the allow-list and the EnvHydrator mapping (2026-08-30 bug fix).
      clientId: env.GITHUB_SYNC_CLIENT_ID || '',
      // secret: stored (encrypted) wins; env value below acts like a seed.
      clientSecret: env.GITHUB_SYNC_CLIENT_SECRET || '',
      cipherFile: env.GITHUB_TOKEN_CIPHER_FILE || '',
      cipherLabel: env.GITHUB_TOKEN_CIPHER_LABEL || '',
    },
    email: {
      // CE deployments set LONG OVERLEAF_EMAIL_* names — prefer those,
      // short EMAIL_* as fallback (2026-08-30).
      skipConfirmation: boolFromEnv(env.EMAIL_CONFIRMATION_DISABLED) === true,
      fromAddress: coreSettings?.email?.fromAddress || env.OVERLEAF_EMAIL_FROM_ADDRESS || env.EMAIL_FROM_ADDRESS || '',
      replyTo: coreSettings?.email?.replyTo || env.OVERLEAF_EMAIL_REPLY_TO || env.EMAIL_REPLY_TO || '',
      driver: (coreSettings?.email && coreSettings.email.driver) || env.OVERLEAF_EMAIL_DRIVER || env.EMAIL_DRIVER || 'smtp',
      host: coreSettings?.email?.host || env.OVERLEAF_EMAIL_SMTP_HOST || env.EMAIL_HOST || '',
      port: coreSettings?.email?.port ?? (env.OVERLEAF_EMAIL_SMTP_PORT || env.EMAIL_PORT ? Number(env.OVERLEAF_EMAIL_SMTP_PORT || env.EMAIL_PORT) : 587),
      secure: boolFromEnv(env.OVERLEAF_EMAIL_SMTP_SECURE) === true || boolFromEnv(env.EMAIL_SECURE) === true,
      ignoreTLS: boolFromEnv(env.OVERLEAF_EMAIL_SMTP_IGNORE_TLS) === true || boolFromEnv(env.EMAIL_IGNORE_TLS) === true,
      name: coreSettings?.email?.smtp?.name || env.OVERLEAF_EMAIL_SMTP_NAME || env.EMAIL_NAME || '',
      user: coreSettings?.email?.user || env.OVERLEAF_EMAIL_SMTP_USER || env.EMAIL_USER || '',
      pass: coreSettings?.email?.pass || env.OVERLEAF_EMAIL_SMTP_PASS || env.EMAIL_PASS || '',
      tlsRejectUnauth: boolFromEnv(env.EMAIL_TLS_REJECT_UNAUTHORIZED) === true,
      accessKeyId: coreSettings?.email?.ses?.accessKeyId || env.OVERLEAF_EMAIL_AWS_SES_ACCESS_KEY_ID || env.EMAIL_SES_ACCESS_KEY_ID || '',
      sesSecret: coreSettings?.email?.ses?.secretKey || env.OVERLEAF_EMAIL_AWS_SES_SECRET_KEY || env.EMAIL_SES_SECRET_ACCESS_KEY || '',
      sesRegion: coreSettings?.email?.ses?.region || env.OVERLEAF_EMAIL_AWS_SES_REGION || env.EMAIL_SES_REGION || '',
    },
    'linked-file-types': {
      // D5: fixed pair first, then admin extras — deduplicated
      // (2026-08-30: seed previously doubled the pair when env also
      // listed them).
      enabledTypes: (function () {
        const forced = ['project_file', 'project_output_file']
        const extra = String(env.ENABLED_LINKED_FILE_TYPES || '')
          .split(',').map(x => x.trim()).filter(Boolean)
        return forced.concat(extra.filter(t => !forced.includes(t)))
      })(),
    },
    pandoc: {
      enabled: boolFromEnv(env.ENABLE_PANDOC_CONVERSIONS) === true,
      image: env.PANDOC_IMAGE || 'pandoc-ol:3.10.0.0',
    },
    // Miscellaneous (2026-09-01): remaining toolkit/env differences surfaced
    // in /admin/site (see TOOLKIT_ENV_GAP.md). Seeds mirror settings.defaults.
    misc: {
      appName: env.APP_NAME || 'Overleaf (Community Edition)',
      navHidePoweredBy: boolFromEnv(env.NAV_HIDE_POWERED_BY) ?? false,
      robotsNoindex: boolFromEnv(env.ROBOTS_NOINDEX) ?? false,
      allowPublicAccess: boolFromEnv(env.OVERLEAF_ALLOW_PUBLIC_ACCESS) ?? false,
      allowAnonymousReadWriteSharing:
        boolFromEnv(env.OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING) ?? false,
      disableLinkSharing: boolFromEnv(env.OVERLEAF_DISABLE_LINK_SHARING) ?? false,
      disableChat: boolFromEnv(env.OVERLEAF_DISABLE_CHAT) ?? false,
      // Deletion delays are MS in env / settings; surfaced to the admin in
      // DAYS for usability.
      projectHardDeletionDelayDays:
        delayDaysFromMs(env, 'OVERLEAF_PROJECT_HARD_DELETION_DELAY', 90),
      userHardDeletionDelayDays:
        delayDaysFromMs(env, 'OVERLEAF_USER_HARD_DELETION_DELAY', 90),
      historyRestore: boolFromEnv(env.OVERLEAF_HISTORY_RESTORE) ?? false,
      enablePdfCaching: boolFromEnv(env.ENABLE_PDF_CACHING) ?? true,
      maxUploadSizeMiB: env.MAX_UPLOAD_SIZE
        ? (parseInt(env.MAX_UPLOAD_SIZE, 10) || 50) : 50,
      maxEntitiesPerProject: env.MAX_ENTITIES_PER_PROJECT
        ? (parseInt(env.MAX_ENTITIES_PER_PROJECT, 10) || 2000) : 2000,
      defaultLatexCompiler: env.DEFAULT_LATEX_COMPILER || 'pdflatex',
    },
  }
}

/**
 * Read one section: stored value with env seeds merged underneath.
 * `coreSettings` = resolved core settings (for env-seed defaults);
 * when omitted, env vars alone provide the seeds.
 */
export async function getSection(name, coreSettings) {
  const doc = await loadDoc()
  const env = globalThis.process.env
  const stored = (doc && doc[name]) || {}
  const seeds = envSeeds(env, coreSettings || {}, stored)[name] || {}
  const merged = { ...cloneDeep(seeds), ...cloneDeep(stored) }

  if (name === 'templates') {
    // Per-key merge: stored wins; stored-only keys are included.
    const seedById = {}
    for (const c of seeds.categories || []) seedById[c.key] = c
    const storedList = stored.categories || []
    const storedById = {}
    for (const c of storedList) storedById[c.key] = c
    const keys = (seeds.categories || []).map(c => c.key)
    for (const c of storedList) {
      if (!keys.includes(c.key)) keys.push(c.key)
    }
    merged.categories = keys.map(
      k => ({ ...(seedById[k] || {}), ...(storedById[k] || {}), key: k })
    )
    delete merged.publishable
  }

  if (name === 'zotero') {
    // Resolve the secret: stored (encrypted) wins, env second.
    let secret = ''
    if (stored.clientSecret) {
      try {
        secret = await decryptText(stored.clientSecret)
      } catch (err) {
        logger.warn(
          { err },
          'SiteSettings: zotero clientSecret decrypt failed; env value used if set'
        )
      }
      if (!secret && seeds.hasEnvSecret) secret = env.ZOTERO_CLIENT_SECRET
    } else if (seeds.hasEnvSecret) {
      secret = env.ZOTERO_CLIENT_SECRET
    }
    merged.clientSecret = secret
    delete merged.hasEnvSecret
  }

  // SSO provider sections: stored (encrypted) secret wins, env seed
  // second. Mirrors the zotero resolution above, generalized over the
  // section's SECRET_FIELDS list.
  const ssoSecrets = SECRET_FIELDS[name]
  if (ssoSecrets && name !== 'zotero') {
    for (const field of ssoSecrets) {
      const storedVal = stored[field]
      let resolved = ''
      if (typeof storedVal === 'string' && storedVal.length > 0) {
        try {
          resolved = await decryptText(storedVal)
        } catch (err) {
          logger.warn(
            { err, section: name, field },
            `SiteSettings: ${name} ${field} decrypt failed; env value used if set`
          )
        }
        if (!resolved) resolved = seeds[field] || ''
      } else {
        resolved = seeds[field] || ''
      }
      merged[field] = resolved
    }
  }

  return merged
}

/**
 * Replace a section (admin-only — the router enforces the admin guard
 * and runs the per-section validator first). A secret field in the
 * payload is the PLAINTEXT new value; an empty string means "keep the
 * previously stored value" (the masked placeholder from the UI).
 */
export async function setSection(name, value) {
  const siteSettings = await getCollection()
  if (!siteSettings) {
    throw new Error('SiteSettings: database unavailable')
  }
  const doc = await loadDoc()
  const existing = (doc && doc[name]) ? cloneDeep(doc[name]) : {}
  const next = cloneDeep(value || {})

  for (const field of SECRET_FIELDS[name] || []) {
    const incoming = next[field]
    if (typeof incoming !== 'string' || incoming === '') {
      next[field] = existing[field] || ''
    } else {
      next[field] = await encryptText(incoming)
    }
    delete next[`${field}Set`]
  }

  const result = await siteSettings.updateOne(
    { _id: SECTION_ID },
    {
      $set: {
        [name]: next,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  )
  await writeSnapshot(siteSettings)
  invalidateCache()
  return {
    upserted: result.upsertedCount === 1,
    modified: result.modifiedCount === 1,
  }
}

/**
 * 2026-08-31 (R12 P0 hardening): after every admin save, keep a timestamped
 * full-document snapshot in `site_settings_snapshots` (last 10). A single
 * section save once left the production doc nearly empty (only `templates`
 * survived); with snapshots the previous state is recoverable in one step
 * regardless of how the doc ended up. Snapshot writes are best-effort — a
 * failure here must never fail the save itself.
 */
async function writeSnapshot(siteSettings) {
  try {
    invalidateCache()
    const doc = await siteSettings.findOne({ _id: SECTION_ID })
    const snapshots = siteSettings.db.collection('site_settings_snapshots')
    await snapshots.insertOne({
      at: new Date(),
      doc,
    })
    const all = await snapshots.find({}).sort({ at: -1 }).toArray()
    if (all.length > 10) {
      await snapshots.deleteMany({ _id: { $in: all.slice(10).map(d => d._id) } })
    }
  } catch (err) {
    logger.warn({ err }, 'SiteSettings: snapshot write failed (non-fatal)')
  }
}

// ---------------------------------------------------------------------------
// Validators (run by the router before setSection)
// ---------------------------------------------------------------------------

export function validateTemplatesSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories)) {
      errors.push('categories must be an array')
    } else {
      const seen = new Set()
      for (const cat of value.categories) {
        if (
          !cat ||
          typeof cat.key !== 'string' ||
          !/^[a-z0-9-]{1,64}$/.test(cat.key)
        ) {
          errors.push('each category needs a key matching ^[a-z0-9-]{1,64}$')
          break
        }
        if (seen.has(cat.key)) {
          errors.push(`duplicate category key: ${cat.key}`)
          break
        }
        seen.add(cat.key)
        if (typeof cat.name !== 'string' || cat.name.length === 0 || cat.name.length > 120) {
          errors.push(`category ${cat.key}: name required (<=120 chars)`)
          break
        }
        if (typeof cat.description !== 'string' || cat.description.length > 500) {
          errors.push(`category ${cat.key}: description must be a string (<=500 chars)`)
          break
        }
      }
    }
  }
  return errors
}

export function validateZoteroSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (
    value.clientKey !== undefined &&
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.clientKey || '')
  ) {
    errors.push('clientKey may only contain letters, digits, _ and -')
  }
  return errors
}

export function validateExternalUrlSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.blockedNetworks !== undefined) {
    if (!Array.isArray(value.blockedNetworks)) {
      errors.push('blockedNetworks must be an array')
    } else {
      for (const cidr of value.blockedNetworks) {
        const ok =
          typeof cidr === 'string' &&
          (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(cidr) ||
            /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}\/\d{1,4}$/.test(cidr) ||
            /^(\d{1,3}\.){3}\d{1,3}$/.test(cidr))
        if (!ok) errors.push(`blockedNetworks: invalid IP/CIDR "${cidr}"`)
      }
    }
  }
  if (value.allowedResourcesRegex !== undefined) {
    if (typeof value.allowedResourcesRegex !== 'string') {
      errors.push('allowedResourcesRegex must be a string ("" to clear)')
    } else if (value.allowedResourcesRegex.length > 0) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(value.allowedResourcesRegex)
      } catch {
        errors.push('allowedResourcesRegex is not a valid regular expression')
      }
    }
  }
  return errors
}

export function validateSignupSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.disabledRedirectUrl !== undefined && typeof value.disabledRedirectUrl !== 'string') {
    errors.push('disabledRedirectUrl must be a string')
  }
  if (value.allowedEmailDomains !== undefined) {
    if (!Array.isArray(value.allowedEmailDomains)) {
      errors.push('allowedEmailDomains must be an array')
    } else {
      for (const d of value.allowedEmailDomains) {
        const okDomain =
          typeof d === 'string' &&
          (d === '*' ||
            /^\*\.[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(d) ||
            /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(d))
        if (!okDomain) errors.push(`allowedEmailDomains: invalid domain "${d}"`)
      }
    }
  }
  return errors
}

export function validateSsoSamlSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.issuer !== 'string' || value.issuer.length === 0) {
      errors.push('issuer is required to enable SAML')
    }
    // A secret (stored or env) is required to verify IdP signatures.
    const hasStored = typeof value.idpCert === 'string' && value.idpCert.length > 0
    if (!hasStored && !process.env.OVERLEAF_SAML_IDP_CERT) {
      errors.push('IdP certificate is required to enable SAML (stored or via OVERLEAF_SAML_IDP_CERT env)')
    }
  }
  return errors
}

export function validateSsoOidcSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    const hasIssuer = typeof value.issuer === 'string' && value.issuer.length > 0
    const hasUrls = typeof value.authorizationURL === 'string' && value.authorizationURL.length > 0
      && typeof value.tokenURL === 'string' && value.tokenURL.length > 0
    if (!hasIssuer && !hasUrls) {
      errors.push('either the issuer URL or the authorization/token URLs are required to enable OIDC')
    }
    if (typeof value.clientID !== 'string' || value.clientID.length === 0) {
      errors.push('clientID is required to enable OIDC')
    }
  }
  if (value.allowedOIDCEmailDomains !== undefined && !Array.isArray(value.allowedOIDCEmailDomains)) {
    errors.push('allowedOIDCEmailDomains must be an array')
  }
  return errors
}

export function validateSsoLdapSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.url !== 'string' || !/^ldaps?:\/\//.test(value.url)) {
      errors.push('url must be an ldapi(s)://… server URL to enable LDAP')
    }
    if (typeof value.searchBase !== 'string' || value.searchBase.length === 0) {
      errors.push('searchBase (base DN) is required to enable LDAP')
    }
  }
  if (value.searchAttributes !== undefined && typeof value.searchAttributes === 'string' && value.searchAttributes.length > 0) {
    try { JSON.parse(value.searchAttributes) } catch { errors.push('searchAttributes must be a JSON array string') }
  }
  return errors
}


// The concrete linked-file agents actually present in this build (core:
// url/project_file/project_output_file; modules: zotero). github-sync and
// git-bridge are integrations, not linked-file agents.
const KNOWN_LINKED_FILE_TYPES = [
  'project_file',
  'project_output_file',
  'url',
  'zotero',
]

export function validateSandboxedCompilesSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  for (const f of ['enabled', 'dockerRunner']) {
    if (value[f] !== undefined && typeof value[f] !== 'boolean') {
      errors.push(`${f} must be a boolean`)
    }
  }
  for (const f of ['hostDir', 'socketPath', 'extraFlags', 'imageUser', 'defaultImage']) {
    if (value[f] !== undefined && typeof value[f] !== 'string') {
      errors.push(`${f} must be a string`)
    }
  }
  // D4 (2026-08-29): image table = index-aligned (image, name) pairs.
  if (value.images !== undefined) {
    if (
      !Array.isArray(value.images) ||
      value.images.length < 1 ||
      value.images.some(r => !r || typeof r.image !== 'string' || r.image.length === 0 ||
        (r.name !== undefined && typeof r.name !== 'string'))
    ) {
      errors.push('images must be a non-empty array of { image, name? } rows')
    } else {
      const seen = new Set()
      for (const r of value.images) {
        if (seen.has(r.image)) {
          errors.push(`duplicate image: ${r.image}`)
          break
        }
        seen.add(r.image)
      }
    }
  }
  return errors
}

export function validateGitIntegrationSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.host !== 'string' || value.host.length === 0) {
      errors.push('host is required to enable git integration')
    }
  }
  if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) {
    errors.push('port must be an integer between 1 and 65535')
  }
  return errors
}

export function validateGithubSyncSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    const cid = value.clientId || value.clientID
    if (typeof cid !== 'string' || cid.length === 0) {
      errors.push('clientId (GitHub OAuth App ID) is required to enable GitHub sync')
    }
    const hasStored = typeof value.clientSecret === 'string' && value.clientSecret.length > 0
    if (!hasStored && !process.env.GITHUB_SYNC_CLIENT_SECRET) {
      errors.push('clientSecret is required to enable GitHub sync (stored or via GITHUB_SYNC_CLIENT_SECRET env)')
    }
  }
  for (const f of ['cipherFile', 'cipherLabel']) {
    if (value[f] !== undefined && typeof value[f] !== 'string') errors.push(`${f} must be a string`)
  }
  return errors
}

export function validateEmailSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (value.skipConfirmation !== undefined && typeof value.skipConfirmation !== 'boolean') {
    errors.push('skipConfirmation must be a boolean')
  }
  if (value.driver !== undefined && !['smtp', 'ses'].includes(value.driver)) {
    errors.push('driver must be "smtp" or "ses"')
  }
  if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) {
    errors.push('port must be an integer between 1 and 65535')
  }
  if (value.driver === 'smtp') {
    if (typeof value.host !== 'string' || value.host.length === 0) {
      errors.push('smtp host is required for the smtp driver')
    }
  }
  if (value.driver === 'ses') {
    if (typeof value.accessKeyId !== 'string' || value.accessKeyId.length === 0) {
      errors.push('SES accessKeyId is required for the ses driver')
    }
    const hasStored = typeof value.sesSecret === 'string' && value.sesSecret.length > 0
    if (!hasStored && !process.env.EMAIL_SES_SECRET_ACCESS_KEY) {
      errors.push('SES secret key is required for the ses driver (stored or env)')
    }
  }
  for (const f of ['fromAddress', 'replyTo', 'user', 'name']) {
    if (value[f] !== undefined && typeof value[f] !== 'string') errors.push(`${f} must be a string`)
  }
  return errors
}

export function validateLinkedFileTypesSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (!Array.isArray(value.enabledTypes)) {
    return ['enabledTypes must be an array of linked file type names']
  }
  // D5 (2026-08-29): project_file + project_output_file are FIXED on.
  for (const fixed of ['project_file', 'project_output_file']) {
    if (!value.enabledTypes.includes(fixed)) {
      errors.push(`${fixed} is always enabled and cannot be removed`)
    }
  }
  for (const t of value.enabledTypes) {
    if (typeof t !== 'string' || !KNOWN_LINKED_FILE_TYPES.includes(t)) {
      errors.push(`unknown linked file type "${t}" (known: ${KNOWN_LINKED_FILE_TYPES.join(', ')})`)
      break
    }
  }
  return errors
}

export function validatePandocSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.image !== 'string' || value.image.length === 0) {
      errors.push('image is required to enable pandoc conversions')
    }
  } else if (value.image !== undefined && typeof value.image !== 'string') {
    errors.push('image must be a string')
  }
  return errors
}

export function validateMiscSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  const booleans = [
    'navHidePoweredBy',
    'robotsNoindex',
    'allowPublicAccess',
    'allowAnonymousReadWriteSharing',
    'disableLinkSharing',
    'disableChat',
    'historyRestore',
    'enablePdfCaching',
  ]
  for (const f of booleans) {
    if (value[f] !== undefined && typeof value[f] !== 'boolean') {
      errors.push(`${f} must be a boolean`)
    }
  }
  const intMin = {
    projectHardDeletionDelayDays: 1,
    userHardDeletionDelayDays: 1,
    maxUploadSizeMiB: 1,
    maxEntitiesPerProject: 1,
  }
  for (const f of Object.keys(intMin)) {
    if (value[f] !== undefined &&
      (!Number.isInteger(value[f]) || value[f] < intMin[f])) {
      errors.push(`${f} must be an integer >= ${intMin[f]}`)
    }
  }
  if (value.appName !== undefined &&
      (typeof value.appName !== 'string' ||
       value.appName.length === 0 || value.appName.length > 64)) {
    errors.push('appName must be a non-empty string (<=64 chars)')
  }
  if (value.defaultLatexCompiler !== undefined &&
      (typeof value.defaultLatexCompiler !== 'string' ||
       value.defaultLatexCompiler.length === 0 ||
       !/^[a-z0-9_-]+$/i.test(value.defaultLatexCompiler))) {
    errors.push('defaultLatexCompiler must be a non-empty compiler name (e.g. pdflatex, lualatexmk)')
  }
  return errors
}

export const SECTION_VALIDATORS = {
  templates: validateTemplatesSection,
  zotero: validateZoteroSection,
  externalUrl: validateExternalUrlSection,
  signup: validateSignupSection,
  'sso-saml': validateSsoSamlSection,
  'sso-oidc': validateSsoOidcSection,
  'sso-ldap': validateSsoLdapSection,
  'sandboxed-compiles': validateSandboxedCompilesSection,
  'git-integration': validateGitIntegrationSection,
  'github-sync': validateGithubSyncSection,
  email: validateEmailSection,
  'linked-file-types': validateLinkedFileTypesSection,
  pandoc: validatePandocSection,
  misc: validateMiscSection,
}
