import logger from '@overleaf/logger'
import passport from 'passport'
import { Strategy as LDAPStrategy } from 'passport-ldapauth'
import Settings from '@overleaf/settings'
import PermissionsManager from '../../../../../app/src/Features/Authorization/PermissionsManager.mjs'
import { readFilesContentFromEnv, numFromEnv, boolFromEnv } from '../../../utils.mjs'
import { getLDAPConfig } from '../../../ssoConfigLoader.mjs'
import LDAPAuthenticationController from './LDAPAuthenticationController.mjs'
import fetchLDAPContacts from './LDAPContacts.mjs'

const LDAPModuleManager = {
  async initSettings() {
    const dbConfig = await getLDAPConfig()
    if (dbConfig) {
      Settings.ldap = {
        enable: true,
        placeholder:  dbConfig.placeholder || 'Username',
        attEmail:     dbConfig.emailAtt || 'mail',
        attFirstName: dbConfig.firstNameAtt || undefined,
        attLastName:  dbConfig.lastNameAtt || undefined,
        attName:      dbConfig.nameAtt || undefined,
        attAdmin:     dbConfig.isAdminAtt || undefined,
        valAdmin:     dbConfig.isAdminAttValue || undefined,
        updateUserDetailsOnLogin: !!dbConfig.updateUserDetailsOnLogin,
      }
      // Store DB config for passport setup
      Settings._ldapDbConfig = dbConfig
    } else {
      Settings.ldap = {
        enable: true,
        placeholder:  process.env.OVERLEAF_LDAP_PLACEHOLDER || 'Username',
        attEmail:     process.env.OVERLEAF_LDAP_EMAIL_ATT || 'mail',
        attFirstName: process.env.OVERLEAF_LDAP_FIRST_NAME_ATT,
        attLastName:  process.env.OVERLEAF_LDAP_LAST_NAME_ATT,
        attName:      process.env.OVERLEAF_LDAP_NAME_ATT,
        attAdmin:     process.env.OVERLEAF_LDAP_IS_ADMIN_ATT,
        valAdmin:     process.env.OVERLEAF_LDAP_IS_ADMIN_ATT_VALUE,
        updateUserDetailsOnLogin: boolFromEnv(process.env.OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN),
      }
    }
  },
  passportSetup(passport, callback) {
    const dbConfig = Settings._ldapDbConfig
    let ldapOptions
    if (dbConfig) {
      let searchAttributes = null
      if (dbConfig.searchAttributes) {
        try { searchAttributes = JSON.parse(dbConfig.searchAttributes) } catch(e) { /* ignore */ }
      }
      ldapOptions = {
        url: dbConfig.url,
        bindDN: dbConfig.bindDN || "",
        bindCredentials: dbConfig.bindCredentials || "",
        bindProperty: dbConfig.bindProperty || undefined,
        searchBase: dbConfig.searchBase,
        searchFilter: dbConfig.searchFilter,
        searchScope: dbConfig.searchScope || 'sub',
        searchAttributes: searchAttributes,
        cache: !!dbConfig.cache,
        timeout: dbConfig.timeout ? Number(dbConfig.timeout) : undefined,
        connectTimeout: dbConfig.connectTimeout ? Number(dbConfig.connectTimeout) : undefined,
        starttls: !!dbConfig.starttls,
        tlsOptions: {
          ca: dbConfig.tlsOptsCAPath ? readFilesContentFromEnv(dbConfig.tlsOptsCAPath) : undefined,
          rejectUnauthorized: dbConfig.tlsOptsRejectUnauth !== false,
        },
      }
    } else {
      ldapOptions = {
        url: process.env.OVERLEAF_LDAP_URL,
        bindDN: process.env.OVERLEAF_LDAP_BIND_DN || "",
        bindCredentials: process.env.OVERLEAF_LDAP_BIND_CREDENTIALS || "",
        bindProperty: process.env.OVERLEAF_LDAP_BIND_PROPERTY,
        searchBase: process.env.OVERLEAF_LDAP_SEARCH_BASE,
        searchFilter: process.env.OVERLEAF_LDAP_SEARCH_FILTER,
        searchScope: process.env.OVERLEAF_LDAP_SEARCH_SCOPE || 'sub',
        searchAttributes: JSON.parse(process.env.OVERLEAF_LDAP_SEARCH_ATTRIBUTES || null),
        cache: boolFromEnv(process.env.OVERLEAF_LDAP_CACHE),
        timeout: numFromEnv(process.env.OVERLEAF_LDAP_TIMEOUT),
        connectTimeout: numFromEnv(process.env.OVERLEAF_LDAP_CONNECT_TIMEOUT),
        starttls: boolFromEnv(process.env.OVERLEAF_LDAP_STARTTLS),
        tlsOptions: {
          ca: readFilesContentFromEnv(process.env.OVERLEAF_LDAP_TLS_OPTS_CA_PATH),
          rejectUnauthorized: boolFromEnv(process.env.OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH),
        },
      }
    }
    try {
      passport.use(
        new LDAPStrategy(
          {
            server: ldapOptions,
            passReqToCallback: true,
            usernameField: 'email',
            passwordField: 'password',
            handleErrorsAsFailures: true,
          },
          LDAPAuthenticationController.doPassportLogin
        )
      )
      callback(null)
    } catch (error) {
      callback(error)
    }
  },

  async getContacts(userId, contacts, callback) {
    try {
      const newContacts = await fetchLDAPContacts(userId, contacts)
      callback(null, newContacts)
    } catch (error) {
      callback(error)
    }
  },

  initPolicy() {
    try {
      PermissionsManager.registerCapability('change-password', { default : true })
      PermissionsManager.registerCapability('use-ai', { default : false })
    } catch (error) {
      logger.info({}, error.message)
    }
    const ldapPolicyValidator = async ({ user, subscription }) => {
// If user is not logged in, user.externalAuth is undefined,
// in this case allow to change password if the user has a hashedPassword
      return user.externalAuth === 'ldap' || (user.externalAuth === undefined && !user.hashedPassword)
    }
    try {
    PermissionsManager.registerPolicy(
      'ldapPolicy',
      { 'change-password' : false },
      { validator: ldapPolicyValidator }
    )
    } catch (error) {
      logger.info({}, error.message)
    }
  },

  getGroupPolicyForUser(user, callback) {
    PermissionsManager.promises.getUserValidationStatus({
      user,
      groupPolicy : { 'ldapPolicy' : true },
      subscription : null
    }).then(userValidationMap => {
      let groupPolicy = Object.fromEntries(userValidationMap)
      callback(null, { groupPolicy })
    }).catch(error => {
      callback(error)
    })
  },
}

export default LDAPModuleManager
