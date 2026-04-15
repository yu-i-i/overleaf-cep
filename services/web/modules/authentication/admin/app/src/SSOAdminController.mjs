import Path from 'path'
import { fileURLToPath } from 'url'
import logger from '@overleaf/logger'
import { db } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { clearConfigCache } from '../../../ssoConfigLoader.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const SSO_CONFIG_ID = 'sso-settings'

function getDefaultConfig() {
  return {
    _id: SSO_CONFIG_ID,
    loginPage: {
      localLoginEnabled: true,
      logoUrl: '',
      title: '',
    },
    ldap: {
      enabled: false,
      url: '',
      bindDN: '',
      bindCredentials: '',
      bindProperty: '',
      searchBase: '',
      searchFilter: '(uid={{username}})',
      searchScope: 'sub',
      searchAttributes: '',
      cache: false,
      timeout: '',
      connectTimeout: '',
      starttls: false,
      tlsOptsCAPath: '',
      tlsOptsRejectUnauth: true,
      placeholder: 'Username',
      emailAtt: 'mail',
      firstNameAtt: '',
      lastNameAtt: '',
      nameAtt: '',
      isAdminAtt: '',
      isAdminAttValue: '',
      updateUserDetailsOnLogin: false,
      contactsFilter: '',
      contactsSearchBase: '',
      contactsSearchScope: '',
      contactsProperty: '',
      contactsNonLdapValue: '',
    },
    providers: [],
  }
}

function getDefaultOIDCProvider() {
  return {
    type: 'oidc',
    name: 'OIDC Provider',
    enabled: false,
    order: 0,
    issuer: '',
    authorizationURL: '',
    tokenURL: '',
    userInfoURL: '',
    clientID: '',
    clientSecret: '',
    scope: 'openid profile email',
    logoutURL: '',
    providerID: 'oidc',
    providerName: 'OIDC Provider',
    providerDescription: '',
    providerInfoLink: '',
    hideWhenNotLinked: false,
    userIdField: 'id',
    isAdminField: '',
    isAdminFieldValue: '',
    updateUserDetailsOnLogin: false,
    allowedEmailDomains: '',
    identityServiceName: '',
    buttonLabel: 'Log in with OIDC',
  }
}

function getDefaultSAMLProvider() {
  return {
    type: 'saml',
    name: 'SAML Provider',
    enabled: false,
    order: 0,
    entryPoint: '',
    issuer: '',
    audience: '',
    idpCert: '',
    privateKey: '',
    decryptionPvk: '',
    decryptionCert: '',
    publicCert: '',
    signatureAlgorithm: '',
    additionalParams: '{}',
    additionalAuthorizeParams: '{}',
    identifierFormat: '',
    acceptedClockSkewMs: '',
    attributeConsumingServiceIndex: '',
    authnContext: '',
    forceAuthn: false,
    disableRequestedAuthnContext: false,
    authnRequestBinding: '',
    validateInResponseTo: '',
    requestIdExpirationPeriodMs: '',
    logoutURL: '',
    additionalLogoutParams: '{}',
    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false,
    userIdField: 'nameID',
    emailField: 'nameID',
    firstNameField: 'givenName',
    lastNameField: 'lastName',
    isAdminField: '',
    isAdminFieldValue: '',
    updateUserDetailsOnLogin: false,
    identityServiceName: '',
    buttonLabel: 'Log in with SAML',
  }
}

const SSOAdminController = {
  async adminPage(req, res) {
    let config = await _getConfig()
    const masked = _maskConfig(config)
    res.render(Path.resolve(__dirname, '../views/sso-admin'), {
      title: 'SSO Configuration',
      ssoConfig: JSON.stringify(masked),
    })
  },

  async getConfig(req, res) {
    try {
      const config = await _getConfig()
      // Mask sensitive fields
      const masked = _maskConfig(config)
      res.json(masked)
    } catch (error) {
      logger.error({ error }, 'Failed to get SSO config')
      res.status(500).json({ error: 'Failed to get SSO configuration' })
    }
  },

  async saveConfig(req, res) {
    try {
      const config = req.body
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Invalid configuration' })
      }
      // Sanitize the config
      const existing = await _getConfig()
      const sanitized = _sanitizeConfig(config, existing)
      sanitized._id = SSO_CONFIG_ID
      
      await db.ssoConfigs.replaceOne(
        { _id: SSO_CONFIG_ID },
        sanitized,
        { upsert: true }
      )
      clearConfigCache()
      logger.info({}, 'SSO configuration saved')
      res.json({ success: true, message: 'Configuration saved. Restart the server for changes to take effect.' })
    } catch (error) {
      logger.error({ error }, 'Failed to save SSO config')
      res.status(500).json({ error: 'Failed to save SSO configuration' })
    }
  },

  async addProvider(req, res) {
    try {
      const { type } = req.body
      if (type !== 'oidc' && type !== 'saml') {
        return res.status(400).json({ error: 'Invalid provider type' })
      }
      const config = await _getConfig()
      const maxOrder = config.providers.reduce((max, p) => Math.max(max, p.order || 0), -1)
      const provider = type === 'oidc' ? getDefaultOIDCProvider() : getDefaultSAMLProvider()
      provider.id = _generateId()
      provider.order = maxOrder + 1
      provider.name = `${type.toUpperCase()} Provider ${config.providers.filter(p => p.type === type).length + 1}`
      provider.buttonLabel = `Log in with ${provider.name}`
      
      config.providers.push(provider)
      await db.ssoConfigs.replaceOne(
        { _id: SSO_CONFIG_ID },
        config,
        { upsert: true }
      )
      clearConfigCache()
      res.json({ success: true, provider: _maskProvider(provider) })
    } catch (error) {
      logger.error({ error }, 'Failed to add provider')
      res.status(500).json({ error: 'Failed to add provider' })
    }
  },

  async deleteProvider(req, res) {
    try {
      const { providerId } = req.params
      const config = await _getConfig()
      config.providers = config.providers.filter(p => p.id !== providerId)
      await db.ssoConfigs.replaceOne(
        { _id: SSO_CONFIG_ID },
        config,
        { upsert: true }
      )
      res.json({ success: true })
    } catch (error) {
      logger.error({ error }, 'Failed to delete provider')
      res.status(500).json({ error: 'Failed to delete provider' })
    }
  },

  async reorderProviders(req, res) {
    try {
      const { orderedIds } = req.body
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: 'Invalid data' })
      }
      const config = await _getConfig()
      orderedIds.forEach((id, index) => {
        const provider = config.providers.find(p => p.id === id)
        if (provider) {
          provider.order = index
        }
      })
      config.providers.sort((a, b) => a.order - b.order)
      await db.ssoConfigs.replaceOne(
        { _id: SSO_CONFIG_ID },
        config,
        { upsert: true }
      )
      res.json({ success: true })
    } catch (error) {
      logger.error({ error }, 'Failed to reorder providers')
      res.status(500).json({ error: 'Failed to reorder providers' })
    }
  },

  async testLdap(req, res) {
    try {
      const config = await _getConfig()
      if (!config.ldap.enabled) {
        return res.json({ success: false, message: 'LDAP is not enabled' })
      }
      const { createClient } = await import('ldapjs')
      const client = createClient({
        url: config.ldap.url,
        connectTimeout: config.ldap.connectTimeout ? Number(config.ldap.connectTimeout) : 5000,
        timeout: config.ldap.timeout ? Number(config.ldap.timeout) : 5000,
      })
      await new Promise((resolve, reject) => {
        client.on('connect', () => {
          client.unbind(() => resolve())
        })
        client.on('error', (err) => reject(err))
        setTimeout(() => reject(new Error('Connection timeout')), 10000)
      })
      res.json({ success: true, message: 'LDAP connection successful' })
    } catch (error) {
      res.json({ success: false, message: `LDAP connection failed: ${error.message}` })
    }
  },

  async testProvider(req, res) {
    try {
      const { providerId } = req.params
      const config = await _getConfig()
      const provider = config.providers.find(p => p.id === providerId)
      if (!provider) {
        return res.json({ success: false, message: 'Provider not found' })
      }
      if (provider.type === 'oidc') {
        return await _testOIDCProvider(provider, res)
      } else if (provider.type === 'saml') {
        return await _testSAMLProvider(provider, res)
      }
      res.json({ success: false, message: 'Unknown provider type' })
    } catch (error) {
      res.json({ success: false, message: `Test failed: ${error.message}` })
    }
  },
}

async function _getConfig() {
  let config = await db.ssoConfigs.findOne({ _id: SSO_CONFIG_ID })
  if (!config) {
    config = _migrateFromEnv()
    if (config.ldap.enabled || config.providers.length > 0) {
      // Save migrated config
      await db.ssoConfigs.replaceOne(
        { _id: SSO_CONFIG_ID },
        config,
        { upsert: true }
      )
      logger.info({}, 'Migrated SSO config from environment variables to database')
    }
  }
  return config
}

function _migrateFromEnv() {
  const config = getDefaultConfig()
  const env = process.env
  // Migrate LDAP settings
  if (env.EXTERNAL_AUTH?.includes('ldap')) {
    config.ldap = {
      ...config.ldap,
      enabled: true,
      url: env.OVERLEAF_LDAP_URL || '',
      bindDN: env.OVERLEAF_LDAP_BIND_DN || '',
      bindCredentials: env.OVERLEAF_LDAP_BIND_CREDENTIALS || '',
      bindProperty: env.OVERLEAF_LDAP_BIND_PROPERTY || '',
      searchBase: env.OVERLEAF_LDAP_SEARCH_BASE || '',
      searchFilter: env.OVERLEAF_LDAP_SEARCH_FILTER || '(uid={{username}})',
      searchScope: env.OVERLEAF_LDAP_SEARCH_SCOPE || 'sub',
      searchAttributes: env.OVERLEAF_LDAP_SEARCH_ATTRIBUTES || '',
      cache: env.OVERLEAF_LDAP_CACHE?.toLowerCase() === 'true',
      timeout: env.OVERLEAF_LDAP_TIMEOUT || '',
      connectTimeout: env.OVERLEAF_LDAP_CONNECT_TIMEOUT || '',
      starttls: env.OVERLEAF_LDAP_STARTTLS?.toLowerCase() === 'true',
      tlsOptsCAPath: env.OVERLEAF_LDAP_TLS_OPTS_CA_PATH || '',
      tlsOptsRejectUnauth: env.OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH?.toLowerCase() !== 'false',
      placeholder: env.OVERLEAF_LDAP_PLACEHOLDER || 'Username',
      emailAtt: env.OVERLEAF_LDAP_EMAIL_ATT || 'mail',
      firstNameAtt: env.OVERLEAF_LDAP_FIRST_NAME_ATT || '',
      lastNameAtt: env.OVERLEAF_LDAP_LAST_NAME_ATT || '',
      nameAtt: env.OVERLEAF_LDAP_NAME_ATT || '',
      isAdminAtt: env.OVERLEAF_LDAP_IS_ADMIN_ATT || '',
      isAdminAttValue: env.OVERLEAF_LDAP_IS_ADMIN_ATT_VALUE || '',
      updateUserDetailsOnLogin: env.OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN?.toLowerCase() === 'true',
      contactsFilter: env.OVERLEAF_LDAP_CONTACTS_FILTER || '',
      contactsSearchBase: env.OVERLEAF_LDAP_CONTACTS_SEARCH_BASE || '',
      contactsSearchScope: env.OVERLEAF_LDAP_CONTACTS_SEARCH_SCOPE || '',
      contactsProperty: env.OVERLEAF_LDAP_CONTACTS_PROPERTY || '',
      contactsNonLdapValue: env.OVERLEAF_LDAP_CONTACTS_NON_LDAP_VALUE || '',
    }
  }

  // Migrate SAML settings
  if (env.EXTERNAL_AUTH?.includes('saml')) {
    const provider = getDefaultSAMLProvider()
    provider.id = _generateId()
    provider.enabled = true
    provider.name = env.OVERLEAF_SAML_IDENTITY_SERVICE_NAME || 'SAML Provider'
    provider.entryPoint = env.OVERLEAF_SAML_ENTRYPOINT || ''
    provider.issuer = env.OVERLEAF_SAML_ISSUER || ''
    provider.audience = env.OVERLEAF_SAML_AUDIENCE || ''
    provider.idpCert = env.OVERLEAF_SAML_IDP_CERT || ''
    provider.privateKey = env.OVERLEAF_SAML_PRIVATE_KEY || ''
    provider.decryptionPvk = env.OVERLEAF_SAML_DECRYPTION_PVK || ''
    provider.decryptionCert = env.OVERLEAF_SAML_DECRYPTION_CERT || ''
    provider.publicCert = env.OVERLEAF_SAML_PUBLIC_CERT || ''
    provider.signatureAlgorithm = env.OVERLEAF_SAML_SIGNATURE_ALGORITHM || ''
    provider.additionalParams = env.OVERLEAF_SAML_ADDITIONAL_PARAMS || '{}'
    provider.additionalAuthorizeParams = env.OVERLEAF_SAML_ADDITIONAL_AUTHORIZE_PARAMS || '{}'
    provider.identifierFormat = env.OVERLEAF_SAML_IDENTIFIER_FORMAT || ''
    provider.acceptedClockSkewMs = env.OVERLEAF_SAML_ACCEPTED_CLOCK_SKEW_MS || ''
    provider.attributeConsumingServiceIndex = env.OVERLEAF_SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX || ''
    provider.authnContext = env.OVERLEAF_SAML_AUTHN_CONTEXT || ''
    provider.forceAuthn = env.OVERLEAF_SAML_FORCE_AUTHN?.toLowerCase() === 'true'
    provider.disableRequestedAuthnContext = env.OVERLEAF_SAML_DISABLE_REQUESTED_AUTHN_CONTEXT?.toLowerCase() === 'true'
    provider.authnRequestBinding = env.OVERLEAF_SAML_AUTHN_REQUEST_BINDING || ''
    provider.validateInResponseTo = env.OVERLEAF_SAML_VALIDATE_IN_RESPONSE_TO || ''
    provider.requestIdExpirationPeriodMs = env.OVERLEAF_SAML_REQUEST_ID_EXPIRATION_PERIOD_MS || ''
    provider.logoutURL = env.OVERLEAF_SAML_LOGOUT_URL || ''
    provider.additionalLogoutParams = env.OVERLEAF_SAML_ADDITIONAL_LOGOUT_PARAMS || '{}'
    provider.wantAssertionsSigned = env.OVERLEAF_SAML_WANT_ASSERTIONS_SIGNED?.toLowerCase() === 'true'
    provider.wantAuthnResponseSigned = env.OVERLEAF_SAML_WANT_AUTHN_RESPONSE_SIGNED?.toLowerCase() === 'true'
    provider.userIdField = env.OVERLEAF_SAML_USER_ID_FIELD || 'nameID'
    provider.emailField = env.OVERLEAF_SAML_EMAIL_FIELD || 'nameID'
    provider.firstNameField = env.OVERLEAF_SAML_FIRST_NAME_FIELD || 'givenName'
    provider.lastNameField = env.OVERLEAF_SAML_LAST_NAME_FIELD || 'lastName'
    provider.isAdminField = env.OVERLEAF_SAML_IS_ADMIN_FIELD || ''
    provider.isAdminFieldValue = env.OVERLEAF_SAML_IS_ADMIN_FIELD_VALUE || ''
    provider.updateUserDetailsOnLogin = env.OVERLEAF_SAML_UPDATE_USER_DETAILS_ON_LOGIN?.toLowerCase() === 'true'
    provider.identityServiceName = env.OVERLEAF_SAML_IDENTITY_SERVICE_NAME || ''
    provider.buttonLabel = env.OVERLEAF_SAML_IDENTITY_SERVICE_NAME || 'Log in with SAML'
    provider.order = 0
    config.providers.push(provider)
  }

  // Migrate OIDC settings
  if (env.EXTERNAL_AUTH?.includes('oidc')) {
    const provider = getDefaultOIDCProvider()
    provider.id = _generateId()
    provider.enabled = true
    provider.name = env.OVERLEAF_OIDC_PROVIDER_NAME || 'OIDC Provider'
    provider.issuer = env.OVERLEAF_OIDC_ISSUER || ''
    provider.authorizationURL = env.OVERLEAF_OIDC_AUTHORIZATION_URL || ''
    provider.tokenURL = env.OVERLEAF_OIDC_TOKEN_URL || ''
    provider.userInfoURL = env.OVERLEAF_OIDC_USER_INFO_URL || ''
    provider.clientID = env.OVERLEAF_OIDC_CLIENT_ID || ''
    provider.clientSecret = env.OVERLEAF_OIDC_CLIENT_SECRET || ''
    provider.scope = env.OVERLEAF_OIDC_SCOPE || 'openid profile email'
    provider.logoutURL = env.OVERLEAF_OIDC_LOGOUT_URL || ''
    provider.providerID = env.OVERLEAF_OIDC_PROVIDER_ID || 'oidc'
    provider.providerName = env.OVERLEAF_OIDC_PROVIDER_NAME || 'OIDC Provider'
    provider.providerDescription = env.OVERLEAF_OIDC_PROVIDER_DESCRIPTION || ''
    provider.providerInfoLink = env.OVERLEAF_OIDC_PROVIDER_INFO_LINK || ''
    provider.hideWhenNotLinked = env.OVERLEAF_OIDC_PROVIDER_HIDE_NOT_LINKED?.toLowerCase() === 'true'
    provider.userIdField = env.OVERLEAF_OIDC_USER_ID_FIELD || 'id'
    provider.isAdminField = env.OVERLEAF_OIDC_IS_ADMIN_FIELD || ''
    provider.isAdminFieldValue = env.OVERLEAF_OIDC_IS_ADMIN_FIELD_VALUE || ''
    provider.updateUserDetailsOnLogin = env.OVERLEAF_OIDC_UPDATE_USER_DETAILS_ON_LOGIN?.toLowerCase() === 'true'
    provider.allowedEmailDomains = env.OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS || ''
    provider.identityServiceName = env.OVERLEAF_OIDC_IDENTITY_SERVICE_NAME || ''
    provider.buttonLabel = env.OVERLEAF_OIDC_IDENTITY_SERVICE_NAME || `Log in with ${provider.name}`
    provider.order = 1
    config.providers.push(provider)
  }

  // Migrate login page settings
  config.loginPage.localLoginEnabled = env.OVERLEAF_SSO_HIDE_LOCAL_LOGIN?.toLowerCase() !== 'true'

  return config
}

function _maskConfig(config) {
  const masked = JSON.parse(JSON.stringify(config))
  // Mask LDAP sensitive fields
  if (masked.ldap.bindCredentials) {
    masked.ldap.bindCredentials = '••••••••'
  }
  // Mask provider sensitive fields
  masked.providers = masked.providers.map(p => _maskProvider(p))
  return masked
}

function _maskProvider(provider) {
  const masked = { ...provider }
  const sensitiveFields = ['clientSecret', 'privateKey', 'decryptionPvk']
  for (const field of sensitiveFields) {
    if (masked[field]) {
      masked[field] = '••••••••'
    }
  }
  return masked
}

function _sanitizeConfig(newConfig, existing) {
  const config = JSON.parse(JSON.stringify(newConfig))
  // Restore masked sensitive fields from existing config
  if (config.ldap?.bindCredentials === '••••••••' && existing?.ldap?.bindCredentials) {
    config.ldap.bindCredentials = existing.ldap.bindCredentials
  }
  if (config.providers) {
    config.providers = config.providers.map(p => {
      const existingProvider = existing?.providers?.find(ep => ep.id === p.id)
      if (existingProvider) {
        const sensitiveFields = ['clientSecret', 'privateKey', 'decryptionPvk']
        for (const field of sensitiveFields) {
          if (p[field] === '••••••••') {
            p[field] = existingProvider[field] || ''
          }
        }
      }
      return p
    })
  }
  return config
}

function _generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

async function _testOIDCProvider(provider, res) {
  try {
    // Test by fetching the OIDC discovery endpoint
    if (provider.issuer) {
      const discoveryUrl = provider.issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration'
      const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10000) })
      if (response.ok) {
        const data = await response.json()
        return res.json({
          success: true,
          message: `OIDC discovery successful. Issuer: ${data.issuer}`,
          details: {
            authorization_endpoint: data.authorization_endpoint,
            token_endpoint: data.token_endpoint,
            userinfo_endpoint: data.userinfo_endpoint,
          }
        })
      }
      return res.json({ success: false, message: `OIDC discovery failed: HTTP ${response.status}` })
    }
    return res.json({ success: false, message: 'No issuer URL configured' })
  } catch (error) {
    return res.json({ success: false, message: `OIDC test failed: ${error.message}` })
  }
}

async function _testSAMLProvider(provider, res) {
  try {
    if (provider.entryPoint) {
      const response = await fetch(provider.entryPoint, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      })
      // SAML IdP entry points typically redirect, so 200 or 3xx are both OK
      if (response.status < 500) {
        return res.json({
          success: true,
          message: `SAML IdP endpoint reachable (HTTP ${response.status})`,
        })
      }
      return res.json({ success: false, message: `SAML IdP returned HTTP ${response.status}` })
    }
    return res.json({ success: false, message: 'No entry point URL configured' })
  } catch (error) {
    return res.json({ success: false, message: `SAML test failed: ${error.message}` })
  }
}

// Export getConfig for use by auth modules
export async function getSSOConfig() {
  return _getConfig()
}

export default SSOAdminController
