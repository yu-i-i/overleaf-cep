/**
 * Per-request template-gallery enablement (admin-managed SiteSetting;
 * env seeds fall back when the admin has not stored a value).
 */
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { getSection } from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'

export async function templateSection() {
  return await getSection('templates', Settings)
}

/** 404 the gallery entirely when the admin has switched it off. */
export async function ensureGalleryEnabled(req, res, next) {
  let section
  try {
    section = await templateSection()
  } catch (err) {
    logger.warn(
      { err },
      'template-gallery: enabled check failed; allowing'
    )
    return next()
  }
  if (section.enabled === false) {
    return res.status(404).send('Not Found')
  }
  return next()
}
