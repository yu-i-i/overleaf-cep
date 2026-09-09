/**
 * Boot env-hydrator (2026-08-29, R9 §7.2/§7.4).
 *
 * Admin-managed sections (sandboxed compiles, git integration, GitHub
 * sync, email, linked file types, pandoc) replace compose env vars. The
 * consumers are **boot-time** readers (Settings snapshot, docker-runner
 * env, compile flags, …) — they read `process.env` while their modules
 * load. So, at web boot — BEFORE the Settings/config modules evaluate —
 * every stored section overrides the matching env var. Stored wins (D2:
 * changes apply on the next container cycle; no live restart from the UI).
 *
 * SSO sections are intentionally NOT hydrated here (D7: SSO is purely
 * admin-managed, resolved per request by modules/authentication).
 */
import logger from '@overleaf/logger'
import { readStoredSection } from './SiteSettingsManager.mjs'

const b = (v) => (v ? 'true' : 'false')

/**
 * @returns {Promise<void>} resolves after env is hydrated (no-op when a
 * section was never saved by an admin — existing env/defaults stand).
 */
export async function hydrateEnvFromStoredSiteSettings() {
  const apply = (name, entries) => {
    for (const [envName, value] of Object.entries(entries)) {
      if (value === undefined || value === null) continue
      process.env[envName] = String(value)
    }
    logger.info({ section: name }, 'boot: env hydrated from stored site settings')
  }

  try {
    const sc = await readStoredSection('sandboxed-compiles')
    if (sc) {
      const images = Array.isArray(sc.images) ? sc.images : []
      const enabled = !!sc.enabled
      apply('sandboxed-compiles', {
        SANDBOXED_COMPILES: b(enabled),
        SANDBOXED_COMPILES_SIBLING_CONTAINERS: b(enabled),
        SIBLING_CONTAINERS_ENABLED: b(enabled || !!sc.dockerRunner),
        DOCKER_RUNNER: b(enabled || !!sc.dockerRunner),
        SANDBOXED_COMPILES_HOST_DIR: sc.hostDir || '',
        COMPILES_HOST_DIR: sc.hostDir || '',
        DOCKER_SOCKET_PATH: sc.socketPath || '',
        TEX_COMPILER_EXTRA_FLAGS: sc.extraFlags || '',
        TEXLIVE_IMAGE_USER: sc.imageUser || '',
        ALL_TEX_LIVE_DOCKER_IMAGES: images.map(r => r?.image).filter(Boolean).join(','),
        ALL_TEX_LIVE_DOCKER_IMAGE_NAMES: images
          .map(r => (r?.name || r?.image || '').trim())
          .join(','),
        TEX_LIVE_DOCKER_IMAGE:
          sc.defaultImage || (images[0] && images[0].image) || '',
      })
    }

    const git = await readStoredSection('git-integration')
    if (git) {
      apply('git-integration', {
        GIT_BRIDGE_ENABLED: b(git.enabled),
        GIT_BRIDGE_HOST: git.host || '',
        GIT_BRIDGE_PORT: git.port ?? '',
      })
    }

    const gh = await readStoredSection('github-sync')
    if (gh) {
      apply('github-sync', {
        GITHUB_SYNC_ENABLED: b(gh.enabled),
        GITHUB_SYNC_CLIENT_ID: gh.clientId || gh.clientID || '',
        GITHUB_SYNC_CLIENT_SECRET: gh.clientSecret || '',
        GITHUB_TOKEN_CIPHER_FILE: gh.cipherFile || '',
        GITHUB_TOKEN_CIPHER_LABEL: gh.cipherLabel || '',
      })
    }

    const email = await readStoredSection('email')
    if (email) {
      // CE's Settings email block reads LONG OVERLEAF_EMAIL_* names
      // (server-ce/config/settings.js) — hydrate those, not short EMAIL_*.
      apply('email', {
        EMAIL_CONFIRMATION_DISABLED: b(email.skipConfirmation),
        OVERLEAF_EMAIL_FROM_ADDRESS: email.fromAddress || '',
        OVERLEAF_EMAIL_REPLY_TO: email.replyTo || '',
        OVERLEAF_EMAIL_DRIVER: email.driver || 'smtp',
        OVERLEAF_EMAIL_SMTP_HOST: email.host || '',
        OVERLEAF_EMAIL_SMTP_PORT: email.port ?? '',
        OVERLEAF_EMAIL_SMTP_SECURE: b(email.secure),
        OVERLEAF_EMAIL_SMTP_IGNORE_TLS: b(email.ignoreTLS),
        OVERLEAF_EMAIL_SMTP_NAME: email.name || '',
        OVERLEAF_EMAIL_SMTP_USER: email.user || '',
        OVERLEAF_EMAIL_SMTP_PASS: email.pass || '',
        OVERLEAF_EMAIL_AWS_SES_ACCESS_KEY_ID: email.accessKeyId || '',
        OVERLEAF_EMAIL_AWS_SES_SECRET_KEY: email.sesSecret || '',
        OVERLEAF_EMAIL_AWS_SES_REGION: email.sesRegion || '',
      })
    }

    const lft = await readStoredSection('linked-file-types')
    if (lft) {
      const types = Array.isArray(lft.enabledTypes) ? lft.enabledTypes : []
      // D5: the fixed pair is always present, in the canonical first slots.
      const merged = ['project_file', 'project_output_file']
      for (const t of types) {
        if (!merged.includes(t)) merged.push(t)
        }
      apply('linked-file-types', {
        ENABLED_LINKED_FILE_TYPES: merged.join(','),
      })
    }

    const pandoc = await readStoredSection('pandoc')
    if (pandoc) {
      apply('pandoc', {
        ENABLE_PANDOC_CONVERSIONS: b(pandoc.enabled),
        PANDOC_IMAGE: pandoc.image || '',
      })
    }

    const misc = await readStoredSection('misc')
    if (misc) {
      // Deletion delays are stored as DAYS in the admin UI; the env/settings
      // value is MILLISECONDS. Pass undefined when unset so `apply` skips it.
      const toMs = (days) =>
        Number.isFinite(Number(days)) && Number(days) > 0
          ? String(Math.round(Number(days) * 24 * 60 * 60 * 1000))
          : undefined
      apply('misc', {
        APP_NAME: misc.appName || '',
        NAV_HIDE_POWERED_BY: b(misc.navHidePoweredBy),
        ROBOTS_NOINDEX: b(misc.robotsNoindex),
        OVERLEAF_ALLOW_PUBLIC_ACCESS: b(misc.allowPublicAccess),
        OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING: b(misc.allowAnonymousReadWriteSharing),
        OVERLEAF_DISABLE_LINK_SHARING: b(misc.disableLinkSharing),
        OVERLEAF_DISABLE_CHAT: b(misc.disableChat),
        OVERLEAF_PROJECT_HARD_DELETION_DELAY: toMs(misc.projectHardDeletionDelayDays),
        OVERLEAF_USER_HARD_DELETION_DELAY: toMs(misc.userHardDeletionDelayDays),
        OVERLEAF_HISTORY_RESTORE: b(misc.historyRestore),
        ENABLE_PDF_CACHING: b(misc.enablePdfCaching),
        MAX_UPLOAD_SIZE: misc.maxUploadSizeMiB ? String(misc.maxUploadSizeMiB) : '',
        MAX_ENTITIES_PER_PROJECT: misc.maxEntitiesPerProject
          ? String(misc.maxEntitiesPerProject) : '',
        DEFAULT_LATEX_COMPILER: misc.defaultLatexCompiler || '',
      })
    }
  } catch (err) {
    // Boot must never fail because of optional stored settings.
    logger.warn({ err }, 'boot: stored site-settings env hydration failed (env defaults stand)')
  }
}

// Self-executing: the web app imports this module early (second import in
// app.mjs). ESM evaluates imports depth-first IN ORDER and a top-level
// await here pauses the whole import graph until hydration finishes, so
// every Settings/env consumer imported AFTER it sees the stored values.
// Errors are caught inside — boot never fails here.
await hydrateEnvFromStoredSiteSettings()
