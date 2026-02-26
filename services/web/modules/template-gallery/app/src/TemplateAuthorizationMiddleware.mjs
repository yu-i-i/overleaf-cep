import Settings from '@overleaf/settings'
import AdminAuthorizationHelper from '../../../../app/src/Features/Helpers/AdminAuthorizationHelper.mjs'
const { hasAdminAccess } = AdminAuthorizationHelper
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { Template } from './models/Template.mjs'

async function ensureTemplateManagementAccess(req, res, next) {
  const user = SessionManager.getSessionUser(req.session)
  const userId = SessionManager.getLoggedInUserId(req.session)

  const isPrivileged =
    hasAdminAccess(user) ||
    Settings.templates?.user_id === userId

  if (isPrivileged) return next()

  const templateId = req.params?.template_id

  if (!templateId) {
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
