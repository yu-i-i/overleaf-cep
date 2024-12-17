import logger from '@overleaf/logger'
import RateLimiterMiddleware from '../../../../../app/src/Features/Security/RateLimiterMiddleware.js'
import CaptchaMiddleware from '../../../../../app/src/Features/Captcha/CaptchaMiddleware.js'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.js'
import { overleafLoginRateLimiter } from '../../../../../app/src/infrastructure/RateLimiter.js'
import LDAPAuthenticationController from './LDAPAuthenticationController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init LDAP router')
    webRouter.post('/login',
      RateLimiterMiddleware.rateLimit(overleafLoginRateLimiter), // rate limit IP (20 / 60s)
      RateLimiterMiddleware.loginRateLimitEmail, // rate limit email (10 / 120s)
      CaptchaMiddleware.validateCaptcha('login'),
      LDAPAuthenticationController.passportLogin,
      AuthenticationController.passportLogin,
    )
  },
}
