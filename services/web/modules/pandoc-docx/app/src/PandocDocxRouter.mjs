import logger from '@overleaf/logger'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import PandocDocxController from './PandocDocxController.mjs'

const rateLimiter = new RateLimiter('pandoc-docx', {
    points: 20,
    duration: 60,
})

export default {
    rateLimiter,
    apply(webRouter) {
        logger.debug({}, 'Init pandoc-docx router')

        webRouter.get(
            '/project/:Project_id/download/docx',
            AuthorizationMiddleware.ensureUserCanReadProject,
            RateLimiterMiddleware.rateLimit(rateLimiter),
            PandocDocxController.downloadDocx
        )
    },
}
