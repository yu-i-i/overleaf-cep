import LanguageToolRouter from './app/src/LanguageToolRouter.mjs'
import logger from '@overleaf/logger'

logger.debug({}, 'Enable LanguageTool module')

const LanguageToolModule = {
  router: LanguageToolRouter,
}

export default LanguageToolModule
