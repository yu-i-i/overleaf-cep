import logger from '@overleaf/logger'

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import TemplateGalleryController from './TemplateGalleryController.mjs'
import TemplateAuthorizationMiddleware from './TemplateAuthorizationMiddleware.mjs'
import { ensureGalleryEnabled } from './TemplateGallerySection.mjs'

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
      ensureGalleryEnabled,
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterNewTemplate),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.createTemplateFromProject
    )

    webRouter.get(
      '/template/:template_id',
      ensureGalleryEnabled,
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.templateDetailsPage
    )

    // 3b (2026-08-28): template bundle save/import (admin console).
    // Export: management access (admin, or the owning non-admin manager).
    // Import: same as create — site admin / configured template manager;
    // per-category publishable still enforced in the manager for the rest.
    // R6 (2026-08-29): admin-facing endpoints must work even while the
    // public gallery is switched OFF (ensureGalleryEnabled 404s them —
    // that's what broke the admin console's bundle card).
    webRouter.get(
      '/api/templates/admin-list',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.getAdminTemplateListJSON
    )

    webRouter.get(
      '/template/:template_id/bundle',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterNewTemplate),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.downloadTemplateBundle
    )
    webRouter.post(
      '/template/bundle/import',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterNewTemplate),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.importTemplateBundle
    )

    // R6 item 5 (2026-08-29): import a bundle from a URL (SSRF-guarded by
    // the External URLs site policy) — same access rules as file import
    // (admin / template gallery admin). No ensureGalleryEnabled: restoring
    // templates must work while the public gallery is switched off.
    webRouter.post(
      '/template/bundle/import-url',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterNewTemplate),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.importTemplateBundleFromUrl
    )

    // R6 item 5/9 (2026-08-29): manage page for template gallery admins
    // (list + download + import from file/url) — beyond the site-admin
    // console, for users holding the scoped role only. Works while the
    // public gallery is off (it is still gated by management access).
    webRouter.get(
      '/templates/manage',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.templateAdminPage
    )

    webRouter.post(
      '/template/:template_id/edit',
      ensureGalleryEnabled,
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.editTemplate
    )

    webRouter.delete(
      '/template/:template_id/delete',
      ensureGalleryEnabled,
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateAuthorizationMiddleware.ensureTemplateManagementAccess,
      TemplateGalleryController.deleteTemplate
    )

    webRouter.get(
      '/templates/:category?',
      ensureGalleryEnabled,
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.templatesCategoryPage
    )

    webRouter.get(
      '/api/template',
      ensureGalleryEnabled,
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.getTemplateJSON
    )

    // New 3 (2026-08-28): enabled categories (public read; the gallery is
    // public by design) for the Templates sub-items in the nav switcher.
    webRouter.get(
      '/api/template/categories',
      ensureGalleryEnabled,
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.getCategoriesJSON
    )

    webRouter.get(
      '/api/templates',
      ensureGalleryEnabled,
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplateGalleryController.getCategoryTemplatesJSON
    )

    webRouter.get(
      '/template/:template_id/preview',
      ensureGalleryEnabled,
      (req, res, next) => {
        const limiter = req.query.style === 'thumbnail' ? rateLimiterThumbnails : rateLimiter
        RateLimiterMiddleware.rateLimit(limiter)(req, res, next)
      },
      TemplateGalleryController.getTemplatePreview
    )
  },
}
