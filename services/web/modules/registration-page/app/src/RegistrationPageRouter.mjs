import logger from "@overleaf/logger"
import Settings from "@overleaf/settings"
import RegistrationPageController from './RegistrationPageController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import RateLimiterMiddleware from "../../../../app/src/Features/Security/RateLimiterMiddleware.mjs"
import { RateLimiter } from "../../../../app/src/infrastructure/RateLimiter.mjs"

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

    webRouter.get('/register', RegistrationPageController.registrationPage)

    webRouter.post(
      '/register',
        RateLimiterMiddleware.rateLimit(registrationRateLimiters.postRegister),
        RegistrationPageController.registerNewUser
    )
  }
}
