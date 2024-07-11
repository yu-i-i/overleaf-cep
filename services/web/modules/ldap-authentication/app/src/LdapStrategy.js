const Settings = require('@overleaf/settings')
const AuthenticationControllerLdap = require('./AuthenticationControllerLdap')
const passport = require('passport')
const LdapStrategy = require('passport-ldapauth').Strategy

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

function addLdapStrategy(passport) {
  passport.use(
    new CustomFailLdapStrategy(
      {
        server: Settings.ldap.server,
        passReqToCallback: true,
        usernameField: 'email',
        passwordField: 'password',
      },
      AuthenticationControllerLdap.doPassportLdapLogin
    )
  )
}

module.exports = { addLdapStrategy }
