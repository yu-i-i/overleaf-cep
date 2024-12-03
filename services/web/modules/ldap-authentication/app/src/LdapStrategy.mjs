import fs from 'fs'
import passport from 'passport'
import Settings from '@overleaf/settings'
import { doPassportLdapLogin } from './AuthenticationControllerLdap.mjs'
import { Strategy as LdapStrategy } from 'passport-ldapauth'

function _readFilesContentFromEnv(envVar) {
// envVar is either a file name: 'file.pem', or string with array: '["file.pem", "file2.pem"]'
  if (!envVar) return undefined
  try {
    const parsedFileNames = JSON.parse(envVar)
    return parsedFileNames.map(filename => fs.readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) { // failed to parse, envVar must be a file name
      return fs.readFileSync(envVar, 'utf8')
    } else {
      throw error
    }
  }
}

//  custom responses on authentication failure
class CustomFailLdapStrategy extends LdapStrategy {
  constructor(options, validate) {
    super(options, validate);
    this.name = 'custom-fail-ldapauth'
  }
  authenticate(req, options) {
    const defaultFail = this.fail.bind(this)
    this.fail = function(info, status) {
      info.type = 'error'
      info.key = 'invalid-password-retry-or-reset'
      info.status = 401
      return defaultFail(info, status)
    }.bind(this)
    super.authenticate(req, options)
  }
}

const ldapServerOpts = {
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
  cache: String(process.env.OVERLEAF_LDAP_CACHE).toLowerCase() === 'true',
  timeout: process.env.OVERLEAF_LDAP_TIMEOUT ? Number(process.env.OVERLEAF_LDAP_TIMEOUT) : undefined,
  connectTimeout: process.env.OVERLEAF_LDAP_CONNECT_TIMEOUT ? Number(process.env.OVERLEAF_LDAP_CONNECT_TIMEOUT) : undefined,
  starttls: String(process.env.OVERLEAF_LDAP_STARTTLS).toLowerCase() === 'true',
  tlsOptions: {
    ca: _readFilesContentFromEnv(process.env.OVERLEAF_LDAP_TLS_OPTS_CA_PATH),
    rejectUnauthorized: String(process.env.OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH).toLowerCase() === 'true',
  }
}

function addLdapStrategy(passport) {
  passport.use(
    new CustomFailLdapStrategy(
      {
        server: ldapServerOpts,
        passReqToCallback: true,
        usernameField: 'email',
        passwordField: 'password',
      },
      doPassportLdapLogin
    )
  )
}

export default addLdapStrategy
