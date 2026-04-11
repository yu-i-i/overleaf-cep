import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import LanguageToolController from './LanguageToolController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init languagetool router')

    // Public endpoint: lets the frontend know whether LT is available
    AuthenticationController.addEndpointToLoginWhitelist('/languagetool/status')
    webRouter.get('/languagetool/status', LanguageToolController.getStatus)

    // Authenticated endpoints
    webRouter.get(
      '/languagetool/languages',
      AuthenticationController.requireLogin(),
      LanguageToolController.getLanguages
    )

    webRouter.post(
      '/languagetool/check',
      AuthenticationController.requireLogin(),
      LanguageToolController.check
    )
  },
}
