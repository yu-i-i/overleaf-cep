import Settings from '@overleaf/settings'
import TemplateGalleryRouter from './app/src/TemplateGalleryRouter.mjs'
import {
  templateSection,
  ensureGalleryEnabled,
} from './app/src/TemplateGallerySection.mjs'

/**
 * The template gallery is ALWAYS registered: on/off is an
 * admin-managed SiteSetting (Manage Site → Templates, stored in the
 * `site_settings` Mongo document; per-request checked in
 * TemplateGalleryRouter via ensureGalleryEnabled). Environment vars
 * (`OVERLEAF_TEMPLATE_GALLERY`, `OVERLEAF_TEMPLATE_CATEGORIES`,
 * `TEMPLATE_<KEY>_NAME/DESCRIPTION`) are SEEDS — used while no stored
 * value exists (SiteSettings semantics: stored wins over env).
 */
const TemplateGalleryModule = {
  router: TemplateGalleryRouter,
  templateSection,
  ensureGalleryEnabled,
}

// Identity/flags used by the authorization middleware (static per
// deployment — not part of the admin on/off).
Settings.templates = {
  nonAdminCanManage:
    process.env.OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES === 'true' || undefined,
  user_id: process.env.OVERLEAF_TEMPLATES_USER_ID,
}

// Env seed for `Settings.templateLinks` (fallback for consumers that
// were not migrated to the per-request section; the admin-managed
// categories win at request time via templateSection()).
const templateKeys = process.env.OVERLEAF_TEMPLATE_CATEGORIES
  ? process.env.OVERLEAF_TEMPLATE_CATEGORIES + ' all'
  : 'all'

Settings.templateLinks = templateKeys.split(/\s+/).map(key => {
  const envKeyBase = key.toUpperCase().replace(/-/g, '_')
  const name = process.env[`TEMPLATE_${envKeyBase}_NAME`] || (key === 'all' ? 'All templates' : key)
  const description = process.env[`TEMPLATE_${envKeyBase}_DESCRIPTION`] || ''

  return {
    name,
    url: `/templates/${key}`,
    description,
  }
})

export default TemplateGalleryModule
