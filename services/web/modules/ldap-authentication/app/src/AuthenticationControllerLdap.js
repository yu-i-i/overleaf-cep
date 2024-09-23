const AuthenticationManagerLdap = require('./AuthenticationManagerLdap')
const AuthenticationController = require('../../../../app/src/Features/Authentication/AuthenticationController')
const LoginRateLimiter = require('../../../../app/src/Features/Security/LoginRateLimiter')
const logger = require('@overleaf/logger')
const { handleAuthenticateErrors } = require('../../../../app/src/Features/Authentication/AuthenticationErrors')
const Modules = require('../../../../app/src/infrastructure/Modules')

const AuthenticationControllerLdap = {
  async doPassportLdapLogin(req, ldapUser, done) {
    let user, info
    try {
      ;({ user, info } = await AuthenticationControllerLdap._doPassportLdapLogin(
        req,
        ldapUser
      ))
    } catch (error) {
      return done(error)
    }
    return done(undefined, user, info)
  },
  async _doPassportLdapLogin(req, ldapUser) {
    const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
    const auditLog = {
      ipAddress: req.ip,
      info: { method: 'LDAP password login', fromKnownDevice },
    }

    let user, isPasswordReused
    try {
      user = await AuthenticationManagerLdap.promises.findOrCreateLdapUser(ldapUser, auditLog)
    } catch (error) {
      return {
        user: false,
        info: handleAuthenticateErrors(error, req),
      }
    }
    if (user && AuthenticationController.captchaRequiredForLogin(req, user)) {
      return {
        user: false,
        info: {
          text: req.i18n.translate('cannot_verify_user_not_robot'),
          type: 'error',
          errorReason: 'cannot_verify_user_not_robot',
          status: 400,
        },
      }
    } else if (user) {
      // async actions
      return { user, info: undefined }
    } else { //something wrong
      logger.debug({ email : ldapUser.mail }, 'failed LDAP log in')
      return {
        user: false,
        info: {
          type: 'error',
          status: 500,
        },
      }
    }
  },
}

module.exports = AuthenticationControllerLdap
