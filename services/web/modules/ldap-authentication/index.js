const Settings = require('@overleaf/settings')
const fs = require('fs')
const { fetchLdapContacts } = require('./app/src/LdapContacts')
const { addLdapStrategy } = require('./app/src/LdapStrategy')

function _initializeLDAP() {
    Settings.ldap = {
    enable: process.env.EXTERNAL_AUTH === 'ldap',
    placeholder: process.env.OVERLEAF_LDAP_PLACEHOLDER || 'username or email address',
    updateUserDetailsOnLogin: process.env.OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN === 'true',
    attEmail:     process.env.OVERLEAF_LDAP_EMAIL_ATT || 'mail',
    attFirstName: process.env.OVERLEAF_LDAP_FIRST_NAME_ATT,
    attLastName:  process.env.OVERLEAF_LDAP_LAST_NAME_ATT,
    attName:      process.env.OVERLEAF_LDAP_NAME_ATT,
    server: {
      url: process.env.OVERLEAF_LDAP_URL,
      bindDN: process.env.OVERLEAF_LDAP_BIND_DN,
      bindCredentials: process.env.OVERLEAF_LDAP_BIND_CREDENTIALS,
      bindProperty: process.env.OVERLEAF_LDAP_BIND_PROPERTY,
      searchBase: process.env.OVERLEAF_LDAP_SEARCH_BASE,
      searchFilter: process.env.OVERLEAF_LDAP_SEARCH_FILTER,
      searchScope: process.env.OVERLEAF_LDAP_SEARCH_SCOPE,
      searchAttributes: process.env.OVERLEAF_LDAP_SEARCH_ATTRIBUTES ?
                             process.env.OVERLEAF_LDAP_SEARCH_ATTRIBUTES.split(',').map(att => att.trim()) : undefined,
      groupSearchBase: process.env.OVERLEAF_LDAP_GROUP_SEARCH_BASE,
      groupSearchFilter: process.env.OVERLEAF_LDAP_GROUP_SEARCH_FILTER,
      groupSearchScope: process.env.OVERLEAF_LDAP_GROUP_SEARCH_SCOPE,
      groupSearchAttributes: process.env.OVERLEAF_LDAP_GROUP_SEARCH_ATTRIBUTES ?
                             process.env.OVERLEAF_LDAP_GROUP_SEARCH_ATTRIBUTES.split(',').map(att => att.trim()) : undefined,
      groupDnProperty: process.env.OVERLEAF_LDAP_GROUP_DN_PROPERTY,
      cache: process.env.OVERLEAF_LDAP_CACHE,
      timeout: process.env.OVERLEAF_LDAP_TIMEOUT,
      connectTimeout: process.env.OVERLEAF_LDAP_CONNECT_TIMEOUT,
      starttls: process.env.OVERLEAF_LDAP_STARTTLS,
      tlsOptions: {
        ca: [fs.readFileSync(process.env.OVERLEAF_LDAP_TLS_OPTS_CA_PATH)],
        rejectUnauthorized: process.env.OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH,
      }
    }
  }
}

_initializeLDAP()

module.exports = {
  name: 'ldap-authentication',
  hooks: {
    passportSetup: function (passport, callback) {
      try {
        addLdapStrategy(passport)
        callback(null)
      } catch (error) {
        callback(error)
      }
    },
    getContacts: async function (userId, contacts, callback) {
      try {
        const newLdapContacts = await fetchLdapContacts(userId, contacts)
        callback(null, newLdapContacts)
      } catch (error) {
        callback(error)
      }
    },
  }
}
