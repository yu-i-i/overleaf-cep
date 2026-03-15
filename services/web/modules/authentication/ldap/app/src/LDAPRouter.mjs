import logger from '@overleaf/logger'
import RateLimiterMiddleware from '../../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import CaptchaMiddleware from '../../../../../app/src/Features/Captcha/CaptchaMiddleware.mjs'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { overleafLoginRateLimiter } from '../../../../../app/src/infrastructure/RateLimiter.mjs'
import LDAPAuthenticationController from './LDAPAuthenticationController.mjs'
import { prepareLdapLoginForRateLimitEmail, restoreLdapLoginAfterRateLimitEmail } from './LDAPRateLimitMiddleware.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init LDAP router')
    webRouter.post('/login',
      RateLimiterMiddleware.rateLimit(overleafLoginRateLimiter), // rate limit IP (20 / 60s)
      prepareLdapLoginForRateLimitEmail(), // for logins with uid
      RateLimiterMiddleware.loginRateLimitEmail('email'), // rate limit email (10 / 120s)
      restoreLdapLoginAfterRateLimitEmail(),
      CaptchaMiddleware.validateCaptcha('login'),
      LDAPAuthenticationController.passportLogin,
      AuthenticationController.passportLogin,
    )
  },
}
