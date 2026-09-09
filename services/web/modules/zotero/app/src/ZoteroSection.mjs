/**
 * Per-request Zotero enablement (admin-managed SiteSetting:
 * Manage Site → Zotero; env seeds fall back when the admin has not
 * stored a value).
 *
 * Semantics when disabled (plan §2.1):
 *  - existing linked files are KEPT (reading/unlinking still works)
 *  - NEW links are rejected
 *  - the "link Zotero" entry in file creation is hidden via the
 *    /user/zotero/status response (see 3c)
 */
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { getSection } from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'

export async function zoteroSection() {
  return await getSection('zotero', Settings)
}

export async function ensureZoteroEnabled(req, res, next) {
  let section
  try {
    section = await zoteroSection()
  } catch (err) {
    logger.warn({ err }, 'zotero: enabled check failed; allowing')
    return next()
  }
  if (section.enabled === false) {
    return res
      .status(403)
      .send('Zotero is disabled on this site')
  }
  return next()
}
