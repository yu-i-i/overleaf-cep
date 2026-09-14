import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import LanguageToolController from './LanguageToolController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init languagetool router')

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
  }
}
