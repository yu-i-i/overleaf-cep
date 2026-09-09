import Settings from '@overleaf/settings'
import { boolFromEnv } from '../authentication/utils.mjs'
import RouterModule from './app/src/RegistrationPageRouter.mjs'

// if the env var is not set, enable registration page iff the external
// authentication is not enabled (the SiteSettings seed default)
let enableRegistrationPage = boolFromEnv(process.env.OVERLEAF_ENABLE_REGISTRATION_PAGE)
if (enableRegistrationPage === undefined) {
  enableRegistrationPage = !(
    Settings.ldap?.enable || Settings.saml?.enable || Settings.oidc?.enable
  )
}

/**
 * The registration page is ALWAYS registered: on/off is an
 * admin-managed SiteSetting (Manage Site → Sign Up, stored in the
 * `site_settings` Mongo document; per-request checked in
 * RegistrationRouterModule via ensureRegistrationEnabled). The value
 * computed above is the SEED (env wins over the SSO default while no
 * stored value exists).
 */
Settings.enableRegistrationPage = enableRegistrationPage

if (process.env.OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS) {
  Settings.allowedRegistrationEmailDomains = process.env.OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS
    .split(/[,\s]+/)
    .filter(Boolean)
}

const RegistrationPageModule = {
  name: 'registration-page',
  router: RouterModule,
}

export default RegistrationPageModule
