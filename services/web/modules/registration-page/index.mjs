import Settings from '@overleaf/settings'
import { boolFromEnv } from '../authentication/utils.mjs'

let RegistrationPageModule = {}

let enableRegistrationPage = boolFromEnv(process.env.OVERLEAF_ENABLE_REGISTRATION_PAGE)

// if the env var is not set, enable registration page iff the external authentication is not enabled
if (enableRegistrationPage === undefined) {
  enableRegistrationPage = !(Settings.ldap?.enable || Settings.saml?.enable || Settings.oidc?.enable)
}

if (enableRegistrationPage) {
  const { default: router } = await import('./app/src/RegistrationPageRouter.mjs')

  Settings.enableRegistrationPage = true

  if (process.env.OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS) {
    Settings.allowedRegistrationEmailDomains = process.env.OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS
      .split(/[,\s]+/)
      .filter(Boolean)
  }

  RegistrationPageModule = {
    name: 'registration-page',
    router: router,
  }
}

export default RegistrationPageModule
