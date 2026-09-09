/**
 * SSO multi-provider config loader (2026-08-29).
 *
 * Same export API as the CE+ (fe4ceb6) `ssoConfigLoader.mjs`, but the
 * source is our **stored site-settings sections** (`sso-saml` / `sso-oidc` /
 * `sso-ldap`) — **no environment variables** (D7: SSO is purely
 * admin-managed; unset section ⇒ provider disabled).
 *
 * Shape mapping: our section field names (attUserId, entrypoint, …) →
 * the CE+ provider object shape (userIdField, entryPoint, …) that the
 * CE+ module managers expect.
 */
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { getSection } from '../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'

const STR = (v, d = undefined) =>
  typeof v === 'string' && v.length > 0 ? v : d

/** SAML provider config in the CE+ shape, or null when disabled/unset. */
export async function getSAMLProviderConfig() {
  let s
  try {
    s = await getSection('sso-saml', Settings)
  } catch (err) {
    logger.warn({ err }, 'ssoConfigLoader: sso-saml section read failed')
    return null
  }
  if (!s || s.enabled !== true) return null
  return {
    type: 'saml',
    enabled: true,
    identityServiceName: STR(s.identityServiceName) || 'Log in with SAML IdP',
    issuer: STR(s.issuer),
    entryPoint: STR(s.entryPoint ?? s.entrypoint),
    audience: STR(s.audience),
    idpCert: STR(s.idpCert),
    privateKey: STR(s.privateKey),
    decryptionPvk: STR(s.decryptionPvk),
    wantAssertionsSigned: !!s.wantAssertionsSigned,
    wantAuthnResponseSigned: !!s.wantAuthnResponseSigned,
    userIdField: STR(s.attUserId, 'nameID'),
    emailField: STR(s.attEmail, 'nameID'),
    firstNameField: STR(s.attFirstName, 'givenName'),
    lastNameField: STR(s.attLastName, 'lastName'),
    isAdminField: STR(s.attAdmin),
    isAdminFieldValue: STR(s.valAdmin),
    updateUserDetailsOnLogin: !!s.updateUserDetailsOnLogin,
  }
}

/** OIDC provider config in the CE+ shape, or null when disabled/unset. */
export async function getOIDCProviderConfig() {
  let o
  try {
    o = await getSection('sso-oidc', Settings)
  } catch (err) {
    logger.warn({ err }, 'ssoConfigLoader: sso-oidc section read failed')
    return null
  }
  if (!o || o.enabled !== true) return null
  return {
    type: 'oidc',
    enabled: true,
    providerID: 'oidc',
    name: 'OIDC Provider',
    identityServiceName:
      STR(o.identityServiceName) || 'Log in with SSO (OIDC)',
    issuer: STR(o.issuer),
    authorizationURL: STR(o.authorizationURL),
    tokenURL: STR(o.tokenURL),
    userInfoURL: STR(o.userInfoURL),
    clientID: STR(o.clientID),
    clientSecret: STR(o.clientSecret),
    scope: STR(o.scope, 'openid profile email'),
    userIdField: STR(o.attUserId, 'id'),
    isAdminField: STR(o.attAdmin),
    isAdminFieldValue: STR(o.valAdmin),
    updateUserDetailsOnLogin: !!o.updateUserDetailsOnLogin,
    allowedEmailDomains: Array.isArray(o.allowedOIDCEmailDomains)
      ? o.allowedOIDCEmailDomains.join(', ')
      : undefined,
  }
}

/** LDAP provider config in the CE+ shape, or null when disabled/unset. */
export async function getLDAPConfig() {
  let l
  try {
    l = await getSection('sso-ldap', Settings)
  } catch (err) {
    logger.warn({ err }, 'ssoConfigLoader: sso-ldap section read failed')
    return null
  }
  if (!l || l.enabled !== true) return null
  return {
    url: STR(l.url),
    searchBase: STR(l.searchBase),
    bindDN: STR(l.bindDN, ''),
    bindCredentials: STR(l.bindCredentials, ''),
    searchFilter: STR(l.searchFilter, ''),
    searchScope: STR(l.searchScope, 'sub'),
    starttls: !!l.starttls,
    placeholder: STR(l.placeholder, 'Username'),
    emailAtt: STR(l.attEmail, 'mail'),
    firstNameAtt: STR(l.attFirstName),
    lastNameAtt: STR(l.attLastName),
    nameAtt: STR(l.attName),
    isAdminAtt: STR(l.attAdmin),
    isAdminAttValue: STR(l.valAdmin),
    updateUserDetailsOnLogin: !!l.updateUserDetailsOnLogin,
  }
}

export async function isSAMLEnabled() {
  const p = await getSAMLProviderConfig()
  return !!p
}

export async function isOIDCEnabled() {
  const p = await getOIDCProviderConfig()
  return !!p
}

export async function isLDAPEnabled() {
  const l = await getLDAPConfig()
  return !!l
}

export async function getLoginPageSettings() {
  // Local login is always available in our setup; SSO buttons are driven
  // by the per-provider enabled flags (login page merge).
  return { localLoginEnabled: true, logoUrl: '', title: '' }
}

export function clearConfigCache() {
  // SiteSettingsManager.invalidateCache() is called on every setSection;
  // sections are read fresh on each resolution. Nothing else to clear.
}

export async function loadSSOConfig() {
  return null
}
