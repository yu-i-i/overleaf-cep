/**
 * R6 (2026-08-29): template gallery admin role.
 *
 * A user may manage the template gallery (edit / delete / import /
 * download any template) when ANY of the following hold:
 *   1. the user is a real (site) admin — `User.isAdmin`;
 *   2. the user carries the scoped flag `flags.canManageTemplates`
 *      (set from /admin/user, per user);
 *   3. the site setting `templates.allUsersCanManageTemplates` is true
 *      (Manage Site → Templates "All users are template gallery admins");
 *   4. the legacy deployment-level `OVERLEAF_TEMPLATES_USER_ID` matches
 *      (kept for parity with upstream CE+ `Settings.templates.user_id`).
 *
 * Real admins and template gallery admins are deliberately separate:
 * a template gallery admin only gets template-management rights and
 * nothing else on the site.
 */
import Settings from '@overleaf/settings'
import { getSection } from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import AdminAuthorizationHelper from '../../../../app/src/Features/Helpers/AdminAuthorizationHelper.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'

async function hasTemplateAdminAccess(user, userId) {
  if (AdminAuthorizationHelper.hasAdminAccess(user)) return true
  if (userId) {
    if (
      Settings.templates?.user_id != null &&
      String(Settings.templates.user_id) === String(userId)
    ) {
      return true
    }
    try {
      const dbUser = await UserGetter.promises.getUser(
        userId,
        { isAdmin: 1, flags: 1 }
      )
      if (dbUser?.isAdmin) return true
      if (dbUser?.flags && dbUser.flags.canManageTemplates) return true
      const section = await getSection('templates', Settings)
      if (section && section.allUsersCanManageTemplates === true) return true
    } catch (err) {
      // fail closed, but keep going: the legacy id check above already ran
    }
  }
  return false
}

export default { hasTemplateAdminAccess }
