import logger from '@overleaf/logger'

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.js'
import TemplateGalleryController from './TemplateGalleryController.mjs'

const rateLimiterNewTemplate = new RateLimiter('create-template-from-project', {
  points: 20,
  duration: 60,
})
const rateLimiter = new RateLimiter('template-gallery', {
  points: 60,
  duration: 60,
})
const rateLimiterThumbnails = new RateLimiter('template-gallery-thumbnails', {
  points: 240,
  duration: 60,
})


export default {
  rateLimiter,
  apply(webRouter) {
    logger.debug({}, 'Init templates router')

    webRouter.post(
      '/template/new/:Project_id',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterNewTemplate),
      TemplateGalleryController.createTemplateFromProject
    )

    webRouter.get(
      '/template/:template_id',
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.templateDetailsPage
    )

    webRouter.post(
      '/template/:template_id/edit',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.editTemplate
    )

    webRouter.delete(
      '/template/:template_id/delete',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.deleteTemplate
    )

    webRouter.get(
      '/templates/:category?',
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.templatesCategoryPage
    )

    webRouter.get(
      '/api/template',
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.getTemplateJSON
    )

    webRouter.get(
      '/api/templates',
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.getCategoryTemplatesJSON
    )

    webRouter.get(
      '/template/:template_id/preview',
      (req, res, next) => {
        req.query.style === 'thumbnail'
          ? RateLimiterMiddleware.rateLimit(rateLimiterThumbnails)(req, res, next)
          : RateLimiterMiddleware.rateLimit(rateLimiter)(req, res, next)
      },
      TemplateGalleryController.getTemplatePreview
    )
  },
}
