const Settings = require('@overleaf/settings')
const fs = require('fs')

function _getFilesContents(paths) {
  return paths.map(path => {
    try {
      const content = fs.readFileSync(path)
      return content
    } catch (error) {
      console.error(`Error reading file at ${path}:`, error)
      return null
    }
  })
}

function initLdapAuthentication() {
  Settings.ldap = {
    enable: process.env.EXTERNAL_AUTH === 'ldap',
    updateUserDetailsOnLogin: process.env.OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN === 'true',
    placeholder: process.env.OVERLEAF_LDAP_PLACEHOLDER || 'Username or email address',
    attEmail:     process.env.OVERLEAF_LDAP_EMAIL_ATT || 'mail',
    attFirstName: process.env.OVERLEAF_LDAP_FIRST_NAME_ATT,
    attLastName:  process.env.OVERLEAF_LDAP_LAST_NAME_ATT,
    attName:      process.env.OVERLEAF_LDAP_NAME_ATT,
    updateAdminOnLogin: process.env.OVERLEAF_LDAP_UPDATE_ADMIN_ON_LOGIN === 'true',
    server: {
      url: process.env.OVERLEAF_LDAP_URL,
      bindDN: process.env.OVERLEAF_LDAP_BIND_DN || "",
      bindCredentials: process.env.OVERLEAF_LDAP_BIND_CREDENTIALS || "",
      bindProperty: process.env.OVERLEAF_LDAP_BIND_PROPERTY,
      searchBase: process.env.OVERLEAF_LDAP_SEARCH_BASE,
      searchFilter: process.env.OVERLEAF_LDAP_SEARCH_FILTER,
      searchScope: process.env.OVERLEAF_LDAP_SEARCH_SCOPE || 'sub',
      searchAttributes: JSON.parse(process.env.OVERLEAF_LDAP_SEARCH_ATTRIBUTES || '[]'),
      groupSearchBase: process.env.OVERLEAF_LDAP_ADMIN_SEARCH_BASE,
      groupSearchFilter: process.env.OVERLEAF_LDAP_ADMIN_SEARCH_FILTER,
      groupSearchScope: process.env.OVERLEAF_LDAP_ADMIN_SEARCH_SCOPE || 'sub',
      groupSearchAttributes: ["dn"],
      groupDnProperty: process.env.OVERLEAF_LDAP_ADMIN_DN_PROPERTY,
      cache: process.env.OVERLEAF_LDAP_CACHE === 'true',
      timeout: process.env.OVERLEAF_LDAP_TIMEOUT,
      connectTimeout: process.env.OVERLEAF_LDAP_CONNECT_TIMEOUT,
      starttls: process.env.OVERLEAF_LDAP_STARTTLS === 'true',
      tlsOptions: {
        ca: _getFilesContents(
              JSON.parse(process.env.OVERLEAF_LDAP_TLS_OPTS_CA_PATH || '[]')
            ),
        rejectUnauthorized: process.env.OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH === 'true',
      }
    }
  }
}

module.exports = { initLdapAuthentication }
