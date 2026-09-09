import Settings from '@overleaf/settings'

/**
 * bib-editor module.
 *
 *  - In-project `.bib` visual editor — registered additively via
 *    `settings.defaults.js` (`sourceEditorExtensions`,
 *    `rootContextProviders`, `visualEditorProviders`,
 *    `moduleImportSequence`) — no change needed here.
 *  - Library (user-scoped reference library, LIBRARY_PLAN.md) — this
 *    module owns the page routes (`/library`, `/library/trashed`) and the
 *    REST API (`/library/references*`) — registered below.
 *
 * Gating: ON by default in CE. Disable with OVERLEAF_BIB_LIBRARY=false —
 * then neither the routes (this file) nor the nav link
 * (settings.defaults.js, same env gate) are active.
 */
function boolFromEnv(env) {
  if (env === undefined || env === null) return undefined
  const envLower = String(env).toLowerCase()
  if (envLower === 'true') return true
  if (envLower === 'false') return false
  return undefined
}

if (Settings.bibLibrary === undefined) {
  const retentionRaw = parseInt(
    process.env.OVERLEAF_BIB_LIBRARY_TRASH_RETENTION_DAYS || '30',
    10
  )
  const enabledEnv = boolFromEnv(process.env.OVERLEAF_BIB_LIBRARY)
  Settings.bibLibrary = {
    // default ON in CE
    enabled: enabledEnv === undefined ? true : enabledEnv,
    trashRetentionDays:
      Number.isFinite(retentionRaw) && retentionRaw > 0 ? retentionRaw : 30,
  }
} else if (Settings.bibLibrary.trashRetentionDays === undefined) {
  Settings.bibLibrary.trashRetentionDays = 30
}
if (Settings.bibLibrary.enabled === undefined) {
  Settings.bibLibrary.enabled = true
}

const bibEditorModule = Settings.bibLibrary.enabled
  ? {
      router:
        (await import('./app/src/LibraryRoutes.mjs')).default,
    }
  : {}

export default bibEditorModule
