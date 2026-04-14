import logger from '@overleaf/logger'
import { db } from '../../app/src/infrastructure/mongodb.mjs'
import { connectionPromise } from '../../app/src/infrastructure/mongodb.mjs'

const SSO_CONFIG_ID = 'sso-settings'

let _cachedConfig = null

/**
 * Get the SSO configuration from the database.
 * Falls back to environment variables if no DB config exists.
 * Caches the result for the lifetime of the process.
 */
export async function loadSSOConfig() {
  if (_cachedConfig) return _cachedConfig

  try {
    await connectionPromise
    const config = await db.ssoConfigs.findOne({ _id: SSO_CONFIG_ID })
    if (config) {
      _cachedConfig = config
      logger.info({}, 'Loaded SSO configuration from database')
      return config
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to load SSO config from database, falling back to env vars')
  }

  // Return null to indicate env-var mode
  return null
}

/**
 * Check if LDAP is enabled (from DB config or env vars)
 */
export async function isLDAPEnabled() {
  const config = await loadSSOConfig()
  if (config) return !!config.ldap?.enabled
  return !!process.env.EXTERNAL_AUTH?.includes('ldap')
}

/**
 * Check if any SAML provider is enabled
 */
export async function isSAMLEnabled() {
  const config = await loadSSOConfig()
  if (config) return config.providers?.some(p => p.type === 'saml' && p.enabled) || false
  return !!process.env.EXTERNAL_AUTH?.includes('saml')
}

/**
 * Check if any OIDC provider is enabled  
 */
export async function isOIDCEnabled() {
  const config = await loadSSOConfig()
  if (config) return config.providers?.some(p => p.type === 'oidc' && p.enabled) || false
  return !!process.env.EXTERNAL_AUTH?.includes('oidc')
}

/**
 * Get LDAP configuration from DB config
 */
export async function getLDAPConfig() {
  const config = await loadSSOConfig()
  if (config) return config.ldap
  return null
}

/**
 * Get the first enabled SAML provider config from DB
 */
export async function getSAMLProviderConfig() {
  const config = await loadSSOConfig()
  if (config) {
    const provider = config.providers?.find(p => p.type === 'saml' && p.enabled)
    return provider || null
  }
  return null
}

/**
 * Get the first enabled OIDC provider config from DB
 */
export async function getOIDCProviderConfig() {
  const config = await loadSSOConfig()
  if (config) {
    const provider = config.providers?.find(p => p.type === 'oidc' && p.enabled)
    return provider || null
  }
  return null
}

/**
 * Get all enabled providers sorted by order for login page
 */
export async function getEnabledProviders() {
  const config = await loadSSOConfig()
  if (config) {
    return (config.providers || [])
      .filter(p => p.enabled)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  }
  // Fall back to env-based providers
  const providers = []
  if (process.env.EXTERNAL_AUTH?.includes('saml')) {
    providers.push({
      type: 'saml',
      buttonLabel: process.env.OVERLEAF_SAML_IDENTITY_SERVICE_NAME || 'Log in with SAML',
      loginUrl: '/saml/login',
      order: 0,
    })
  }
  if (process.env.EXTERNAL_AUTH?.includes('oidc')) {
    providers.push({
      type: 'oidc',
      buttonLabel: process.env.OVERLEAF_OIDC_IDENTITY_SERVICE_NAME || 'Log in with OIDC',
      loginUrl: '/oidc/login',
      order: 1,
    })
  }
  return providers
}

/**
 * Get login page settings
 */
export async function getLoginPageSettings() {
  const config = await loadSSOConfig()
  if (config) {
    return config.loginPage || { localLoginEnabled: true, logoUrl: '', title: '' }
  }
  return {
    localLoginEnabled: process.env.OVERLEAF_SSO_HIDE_LOCAL_LOGIN?.toLowerCase() !== 'true',
    logoUrl: '',
    title: '',
  }
}

/**
 * Clear the cached config (e.g., after saving new config)
 */
export function clearConfigCache() {
  _cachedConfig = null
}
