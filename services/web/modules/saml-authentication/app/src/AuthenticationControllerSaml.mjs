import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import passport from 'passport'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.js'
import AuthenticationManagerSaml from './AuthenticationManagerSaml.mjs'
import UserController from '../../../../app/src/Features/User/UserController.js'
import UserSessionsManager from '../../../../app/src/Features/User/UserSessionsManager.js'
import { handleAuthenticateErrors } from '../../../../app/src/Features/Authentication/AuthenticationErrors.js'
import { xmlResponse } from '../../../../app/src/infrastructure/Response.js'

const AuthenticationControllerSaml = {
  passportSamlAuthWithIdP(req, res, next) {
    if ( passport._strategy('saml')._saml.options.authnRequestBinding === 'HTTP-POST') {
      const csp = res.getHeader('Content-Security-Policy')
      if (csp) {
        res.setHeader(
          'Content-Security-Policy',
          csp.replace(/(?:^|\s)(default-src|form-action)[^;]*;?/g, '')
        )
      }
    }
    passport.authenticate('saml')(req, res, next)
  },
  passportSamlLogin(req, res, next) {
    // This function is middleware which wraps the passport.authenticate middleware,
    // so we can send back our custom `{message: {text: "", type: ""}}` responses on failure,
    // and send a `{redir: ""}` response on success
    passport.authenticate(
      'saml',
      { keepSessionInfo: true },
      async function (err, user, info) {
        if (err) {
          return next(err)
        }
        if (user) {
          // `user` is either a user object or false
          AuthenticationController.setAuditInfo(req, {
            method: 'SAML login',
          })
          try {
            await AuthenticationController.promises.finishLogin(user, req, res)
          } catch (err) {
            return next(err)
          }
        } else {
          if (info.redir != null) {
            return res.json({ redir: info.redir })
          } else {
            res.status(info.status || 200)
            delete info.status
            const body = { message: info }
            const { errorReason } = info
            if (errorReason) {
              body.errorReason = errorReason
              delete info.errorReason
            }
            return res.json(body)
          }
        }
      }
    )(req, res, next)
  },
  async doPassportSamlLogin(req, profile, done) {
    let user, info
    try {
      ;({ user, info } = await AuthenticationControllerSaml._doPassportSamlLogin(
        req,
        profile
      ))
    } catch (error) {
      return done(error)
    }
    return done(undefined, user, info)
  },
  async _doPassportSamlLogin(req, profile) {
    const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
    const auditLog = {
      ipAddress: req.ip,
      info: { method: 'SAML login', fromKnownDevice },
    }

    let user
    try {
      user = await AuthenticationManagerSaml.promises.findOrCreateSamlUser(profile, auditLog)
    } catch (error) {
      return {
        user: false,
        info: handleAuthenticateErrors(error, req),
      }
    }
    if (user) {
      req.session.saml_extce = {nameID : profile.nameID, sessionIndex : profile.sessionIndex}
      return { user, info: undefined }
    } else { //something wrong
      logger.debug({ email : profile.mail }, 'failed SAML log in')
      return {
        user: false,
        info: {
          type: 'error',
          text: 'Unknown error',
          status: 500,
        },
      }
    }
  },
  async passportSamlSPLogout(req, res, next) {
    passport._strategy('saml').logout(req, async (err, url) => {
      if (err) logger.error({ err }, 'can not generate logout url')
      await UserController.promises.doLogout(req)
      res.redirect(url)
    })
  },
  passportSamlIdPLogout(req, res, next) {
    passport.authenticate('saml')(req, res, (err) => {
      if (err) return next(err)
      res.redirect('/login');
    })
  },
  async doPassportSamlLogout(req, profile, done) {
    let user, info
    try {
      ;({ user, info } = await AuthenticationControllerSaml._doPassportSamlLogout(
        req,
        profile
      ))
    } catch (error) {
      return done(error)
    }
    return done(undefined, user, info)
  },
  async _doPassportSamlLogout(req, profile) {
    if (req?.session?.saml_extce?.nameID === profile.nameID &&
        req?.session?.saml_extce?.sessionIndex === profile.sessionIndex) {
      profile = req.user
    }
    await UserSessionsManager.promises.untrackSession(req.user, req.sessionID).catch(err => {
      logger.warn({ err, userId: req.user._id }, 'failed to untrack session')
    })
    return { user: profile, info: undefined }
  },
  passportSamlMetadata(req, res) {
    const samlStratery = passport._strategy('saml')
    res.setHeader('Content-Disposition', `attachment; filename="${samlStratery._saml.options.issuer}-meta.xml"`)
    xmlResponse(res,
      samlStratery.generateServiceProviderMetadata(
        samlStratery._saml.options.decryptionCert,
        samlStratery._saml.options.signingCert
      )
    )
  },
}
export const {
  passportSamlAuthWithIdP,
  passportSamlLogin,
  passportSamlSPLogout,
  passportSamlIdPLogout,
  doPassportSamlLogin,
  doPassportSamlLogout,
  passportSamlMetadata,
} = AuthenticationControllerSaml
