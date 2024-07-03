const AuthenticationManagerLdap = require('./AuthenticationManagerLdap')
const AuthenticationController = require('../../../../app/src/Features/Authentication/AuthenticationController')
const LoginRateLimiter = require('../../../../app/src/Features/Security/LoginRateLimiter')
const logger = require('@overleaf/logger')
const {
  ParallelLoginError,
} = require('../../../../app/src/Features/Authentication/AuthenticationErrors')
const Modules = require('../../../../app/src/infrastructure/Modules')

const AuthenticationControllerLdap = {
  doPassportLdapLogin(req, ldapUser, done) {
    const  email = ldapUser.mail.toLowerCase()
    Modules.hooks.fire(
      'preDoPassportLogin',
      req,
      email,
      function (err, infoList) {
        if (err) {
          return done(err)
        }
        const info = infoList.find(i => i != null)
        if (info != null) {
          return done(null, false, info)
        }
        LoginRateLimiter.processLoginRequest(email, function (err, isAllowed) {
          if (err) {
            return done(err)
          }
          if (!isAllowed) {
            logger.debug({ email }, 'too many login requests')
            return done(null, null, {
              text: req.i18n.translate('to_many_login_requests_2_mins'),
              type: 'error',
              key: 'to-many-login-requests-2-mins',
              status: 429,
            })
          }
          const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
          const auditLog = {
            ipAddress: req.ip,
            info: { method: 'LDAP login', fromKnownDevice },
          }
          AuthenticationManagerLdap.findOrCreateLdapUser(
            ldapUser,
            auditLog,
            function (error, user) {
              if (error != null) {
                if (error instanceof ParallelLoginError) {
                  return done(null, false, { status: 429 })
                }
                return done(error)
              }
              if (
                user &&
                AuthenticationController.captchaRequiredForLogin(req, user)
              ) {
                done(null, false, {
                  text: req.i18n.translate('cannot_verify_user_not_robot'),
                  type: 'error',
                  errorReason: 'cannot_verify_user_not_robot',
                  status: 400,
                })
              } else if (user) {
                // async actions
                done(null, user)
              } else {  //something wrong
                logger.debug({ email }, 'user is null')
                done(null, false, { status: 500 } )
              }
            }
          )
        })
      }
    )
  },
}

module.exports = AuthenticationControllerLdap
