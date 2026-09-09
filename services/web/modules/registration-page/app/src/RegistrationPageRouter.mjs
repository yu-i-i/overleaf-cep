import logger from "@overleaf/logger"
import RegistrationPageController from './RegistrationPageController.mjs'
import RateLimiterMiddleware from "../../../../app/src/Features/Security/RateLimiterMiddleware.mjs"
import { RateLimiter } from "../../../../app/src/infrastructure/RateLimiter.mjs"
import { ensureRegistrationEnabled } from './RegistrationSection.mjs'

// Limit registration attempts to 3 per minute per IP
const registrationRateLimiters = {
  postRegister: new RateLimiter('postRegister', {
    points: 5,
    duration: 60,
  }),
}

export default {
  apply(webRouter) {
    logger.debug({}, 'Init Registration Page module')

    // remove default registration router if it exists
    webRouter.stack = webRouter.stack.filter(layer => {
      return !(layer.route && layer.route.path === '/register' && layer.route.methods.get)
    })

    webRouter.get('/register', ensureRegistrationEnabled, RegistrationPageController.registrationPage)

    webRouter.post(
      '/register',
      ensureRegistrationEnabled,
      RateLimiterMiddleware.rateLimit(registrationRateLimiters.postRegister),
      RegistrationPageController.registerNewUser
    )
  }
}
