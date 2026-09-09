import Settings from '@overleaf/settings'
import { getSection } from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import TemplateAuthorizationHelper from './TemplateAuthorizationHelper.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { Template } from './models/Template.mjs'

async function ensureTemplateManagementAccess(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  const userId = SessionManager.getLoggedInUserId(req.session)

  // R6 (2026-08-29): template gallery admin role — site admin, or the
  // scoped `flags.canManageTemplates` flag, or the site setting
  // "all users are template gallery admins", or the legacy
  // OVERLEAF_TEMPLATES_USER_ID.
  const isPrivileged = await TemplateAuthorizationHelper.hasTemplateAdminAccess(user, userId)

  if (isPrivileged) return next()

  const templateId = req.params?.template_id

  if (!templateId) {
    // 3a (2026-08-28): per-category publish permission from the admin
    // console (Manage Extensions → Templates "Publishable"; stored value
    // wins). An explicit per-category decision overrides the legacy
    // site-wide OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES setting.
    const category = req.body && req.body.category
    if (category) {
      try {
        const section = await getSection('templates', Settings)
        const cat = (section.categories || []).find(c => c.key === category)
        if (cat && cat.publishable === false) {
          return HttpErrorHandler.forbidden(req, res)
        }
        if (cat && cat.publishable === true) return next()
      } catch (err) {
        // fall through to the legacy check below
      }
    }
    if (Settings.templates?.nonAdminCanManage) return next()
    return HttpErrorHandler.forbidden(req, res)
  }

  // unprivileged owner is allowed to edit/delete own template
  // even non-admin is not allowed to manage templates
  const template = await Template.findById(templateId)
    .select('owner')
    .lean()

  if (template?.owner?.toString() === userId) return next()

  return HttpErrorHandler.forbidden(req, res)
}

export default {
  ensureTemplateManagementAccess,
}
