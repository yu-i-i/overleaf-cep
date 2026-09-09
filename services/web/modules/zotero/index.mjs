import Settings from '@overleaf/settings'
import ZoteroRouter from './app/src/ZoteroRouter.mjs'

/**
 * The Zotero module is ALWAYS registered (de-bootgated): runtime
 * on/off is the admin-managed SiteSetting (Manage Site → Zotero,
 * per-request checks in ZoteroRouter + LinkedFilesController; the
 * `ENABLED_LINKED_FILE_TYPES` env membership remains the deployment
 * seed for whether the connector ships at all).
 *
 * Secrets: the env values (ZOTERO_CLIENT_KEY/SECRET) are SEEDS; the
 * admin-stored (encrypted) values win per request — see 3c for the
 * per-request accessor in the OAuth flow.
 */
const { default: ZoteroLinkedFileAgent } = await import('./app/src/ZoteroLinkedFileAgent.mjs')

const siteUrl = Settings.siteUrl.replace(/\/+$/, '') || 'http://localhost'
Settings.zotero = {
  clientKey: process.env.ZOTERO_CLIENT_KEY,
  clientSecret: process.env.ZOTERO_CLIENT_SECRET,
  callbackURL: `${siteUrl}/user/zotero/oauth/callback`,
}

/**
 * R7 (2026-08-29): credentials live in site_settings (encrypted,
 * decrypted per request by the SiteSettings manager). Seed Settings.zotero
 * here (at boot) so the user-settings "Zotero connector" widget gate
 * (ExposedSettings.zoteroEnabled) and other env-shape consumers know the
 * connector is configured when the admin has stored credentials.
 * The stored clientSecret is ENCRYPTED — we deliberately set a sentinel
 * ("configured") rather than exposing the ciphertext; request-time code
 * uses SiteSettingsManager.getSection('zotero') for the real value.
 */
try {
  const mongodb = await import('../../app/src/infrastructure/mongodb.mjs')
  await mongodb.connectionPromise
  const doc = await mongodb.db.siteSettings.findOne({ _id: 'global' })
  if (doc?.zotero) {
    const storedKey = String(doc.zotero.clientKey || '').trim()
    if (storedKey) {
      Settings.zotero = {
        ...Settings.zotero,
        clientKey: storedKey,
        clientSecret: Settings.zotero?.clientSecret || 'configured',
      }
    }
  }
} catch (err) {
  // Mongo not reachable at boot / no doc — env seeds remain the source.
}

const ZoteroModule = {
  router: ZoteroRouter,
  linkedFileAgents: {
    zotero: () => ZoteroLinkedFileAgent,
  },
}

export default ZoteroModule
