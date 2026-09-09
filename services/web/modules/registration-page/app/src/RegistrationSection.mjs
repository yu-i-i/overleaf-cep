/**
 * Per-request registration-page enablement (admin-managed SiteSetting;
 * env seeds fall back when the admin has not stored a value).
 */
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { getSection } from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'

export async function signupSection() {
  return await getSection('signup', Settings)
}

/** Hide the register page + endpoint when the admin switched it off. */
export async function ensureRegistrationEnabled(req, res, next) {
  let section
  try {
    section = await signupSection()
  } catch (err) {
    // Fail OPEN on read errors: the register page is the only way for
    // users to join sites without SSO — a Mongo hiccup should not lock
    // everyone out.
    logger.warn({ err }, 'registration: enabled check failed; allowing')
    return next()
  }
  if (section.enabled === false) {
    if (req.method === 'POST') {
      return res.status(403).send('Registration is disabled on this site')
    }
    // New 1: admins choose where /register sends visitors when the sign-up
    // page is off (empty → default /login).
    return res.redirect(section.disabledRedirectUrl || '/login')
  }
  return next()
}
