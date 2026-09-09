import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import TemplateAuthorizationHelper from './TemplateAuthorizationHelper.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'
import TemplateGalleryManager from'./TemplateGalleryManager.mjs'
import { getUserName } from './TemplateGalleryHelper.mjs'
import { TemplateNameConflictError, RecompileRequiredError } from './TemplateErrors.mjs'
import { BundleValidationIssuesError, validateTemplateBundle } from './TemplateGalleryManager.mjs'
import Settings from '@overleaf/settings'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

async function createTemplateFromProject(req, res, next) {
  const t = req.i18n.translate
  try {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const result = await TemplateGalleryManager.createTemplateFromProject({
      projectId: req.params.Project_id,
      userId,
      templateSource: req.body,
    })
    if (result.conflict) {
      const ownerName = (result.templateOwnerName === 'you') ? t('you') : result.templateOwnerName
      const message = `${t('template_with_this_title_exists_and_owned_by_x', { x: ownerName })} `
                    + t(result.canOverride ? 'do_you_want_to_overwrite_it' : 'you_cant_overwrite_it')
      return res.status(409).json({ canOverride: result.canOverride, message })
    }
    return res.status(200).json({ template_id: result.templateId })
  } catch (error) {
    if (error instanceof Errors.InvalidNameError) {
      return res.status(error.info?.status || 400).json({ message: error.message })
    }

    const mainMessage = t('failed_to_publish_as_a_template')
    if (error instanceof RecompileRequiredError) {
      return res.status(error.info?.status || 400).json({
        message: `${mainMessage} ${t('try_recompile_project')}`
      })
    }
    return res.status(400).json({ message: mainMessage })
  }
}

async function editTemplate(req, res, next) {
  const t = req.i18n.translate
  try {
    const result = await TemplateGalleryManager.editTemplate({
      templateId: req.params.template_id,
      updates: req.body
    })
    res.status(200).json(result)
  } catch (error) {
    if (error instanceof TemplateNameConflictError) {
      const ownerId = error.info?.ownerId
      const userId = SessionManager.getLoggedInUserId(req.session)
      const ownerName = (ownerId === userId)
        ? t('you')
        : await getUserName(ownerId) || t('unknown')
      const message = t(error.message, { x: ownerName })
      return res.status(409).json({ message })
    }
    if (error instanceof Errors.InvalidNameError) {
      return res.status(error.info?.status || 400).json({ message: error.message })
    }
    logger.error({ error }, 'Failure saving template')
    return res.status(500).json({ message: t('something_went_wrong_server') })
  }
}

async function deleteTemplate(req, res, next) {
  const t = req.i18n.translate
  try {
    await TemplateGalleryManager.deleteTemplate({
      templateId: req.params.template_id,
      version: req.body.version
    })
    res.sendStatus(200)
  } catch (error) {
    logger.error({ error }, 'Failure deleting template')
    return res.status(500).json({ message: t('something_went_wrong_server') })
  }
}

async function getTemplatePreview(req, res, next) {
  try {
    const templateId = req.params.template_id
    const { version, style } = req.query

    const { stream, contentType } = await TemplateGalleryManager.fetchTemplatePreview({ templateId, version, style })

    res.setHeader('Content-Type', contentType)
    stream.pipe(res)
  } catch (error) {
    if (error.info?.status == 404) {
      return ErrorController.notFound(req, res, next)
    }
    return res.status(error.info?.status || 400).json(error.info)
  }
}

/**
 * Theme support parity with /project + /library: expose the logged-in
 * user's overallTheme (ol-userSettings meta) so useThemedPage follows the
 * Dark/Light/System setting and the account menu renders the theme
 * toggle (ol-overallThemes is a global render local).
 */
async function themeLocals(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (!userId) return {}
  try {
    const user = await UserGetter.promises.getUser(userId)
    if (!user) return {}
    const userSettings = await UserSettingsHelper.buildUserSettings(req, res, user)
    return { userSettings }
  } catch (err) {
    logger.warn({ err, userId }, 'template-gallery: theme locals unavailable; page renders with defaults')
    return {}
  }
}

async function templatesCategoryPage(req, res, next) {
  const t = req.i18n.translate
  try {
    let { category } = req.params
    const result = await TemplateGalleryManager.getTemplatesPageData(category)
    const userId = SessionManager.getLoggedInUserId(req.session)

    let title
    if (result.categoryName) {
      title = t('latex_templates') + ' — ' + result.categoryName
    } else {
      category = null
      title = t('templates_page_title')
    }
    // R6 (2026-08-29): the template-gallery admin box (import from file /
    // url) is shown to users with the template gallery admin role.
    const userIsTemplatesManager = await TemplateAuthorizationHelper.hasTemplateAdminAccess(
      SessionManager.getSessionUser(req.session),
      userId
    )
    res.render(Path.resolve(__dirname, '../views/template_gallery/template-gallery'), {
      title,
      category,
      userIsTemplatesManager,
      ...await themeLocals(req, res),
    })
  } catch (error) {
    next(error)
  }
}

async function templateDetailsPage(req, res, next) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const template = await TemplateGalleryManager.getTemplate('_id', req.params.template_id)
    res.render(Path.resolve(__dirname, '../views/template_gallery/template'), {
      title: `${t('template')}: ${template.name}`,
      template: JSON.stringify(template),
      languages: Settings.languages,
      userIsTemplatesManager: await TemplateAuthorizationHelper.hasTemplateAdminAccess(SessionManager.getSessionUser(req.session), userId),
      ...await themeLocals(req, res),
    })
  } catch (error) {
    return ErrorController.notFound(req, res, next)
  }
}

async function getTemplateJSON(req, res, next) {
  try {
    const { key, val } = req.query
    const template = await TemplateGalleryManager.getTemplate(key, val)
    res.json(template)
  } catch (error) {
    next(error)
  }
}

async function getCategoryTemplatesJSON(req, res, next) {
  try {
    const result = await TemplateGalleryManager.getCategoryTemplates(req.query)
    res.json(result)
  } catch (error) {
    next(error)
  }
}

/** R6 (2026-08-29): list ALL templates for the admin console / manage
 *  page. Deliberately NOT gated by ensureGalleryEnabled — bundle
 *  management must work while the public gallery is switched off. */
async function getAdminTemplateListJSON(req, res, next) {
  try {
    const result = await TemplateGalleryManager.getCategoryTemplates({
      category: 'all',
      by: 'lastUpdated',
      order: 'desc',
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
}

/** New 3: GET /api/template/categories — enabled categories for the
 *  navigation switcher's Templates sub-items. */
async function getCategoriesJSON(req, res, next) {
  try {
    const categories = await TemplateGalleryManager.getEnabledCategories()
    res.json(categories)
  } catch (error) {
    next(error)
  }
}

/** 3b: GET /template/:template_id/bundle — download a template bundle
 *  (template.json + source.zip + output.pdf) for save/restore. */
async function downloadTemplateBundle(req, res) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const { buffer, filename, contentType } =
      await TemplateGalleryManager.getTemplateBundle({
        templateId: req.params.template_id,
        userId,
      })
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', String(buffer.length))
    res.end(buffer)
  } catch (error) {
    const status = error.status || 500
    logger.error({ error, templateId: req.params.template_id }, 'template bundle download failed')
    res.status(status).json({ message: status === 403 ? t('You are not allowed to do that') : error.message })
  }
}

/** 3b: POST /template/bundle/import — import a template bundle
 *  (base64 zip in body.data; body.override replaces an existing template
 *  with the same name).
 *  R6 item 5: validation failures come back as 422 + { issues: [...] } so
 *  the UI can show a complete, fixable checklist. */
async function importTemplateBundle(req, res) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = SessionManager.getSessionUser(req.session)
  try {
    const { data, override } = req.body || {}
    if (typeof data !== 'string' || data.length === 0) {
      return res.status(400).json({ message: t('bundle_data_missing') })
    }
    const privileged = await TemplateAuthorizationHelper.hasTemplateAdminAccess(user, userId)
    const result = await TemplateGalleryManager.importTemplateBundle({
      data: Buffer.from(data, 'base64'),
      userId,
      override: !!override,
      privileged,
    })
    return res.json({
      template_id: result.templateId,
      version: result.version,
      created: result.created,
    })
  } catch (error) {
    if (error instanceof TemplateNameConflictError) {
      const ownerName = error.info?.ownerId === userId ? t('you') : error.info?.ownerId || 'unknown'
      return res.status(409).json({
        canOverride: true,
        message: t('template_with_this_title_exists_and_owned_by_x', { x: ownerName }),
      })
    }
    if (error instanceof BundleValidationIssuesError) {
      return res.status(422).json({
        issues: error.issues,
        message: t('bundle_rejected'),
      })
    }
    const status = error.status || 500
    logger.error({ error }, 'template bundle import failed')
    res.status(status).json({ message: error.message })
  }
}

/** R6 item 5: POST /template/bundle/import-url — import a bundle from a
 *  URL (checked against the External URLs site policy; every redirect hop
 *  re-checked). Same access rules as file import (admin / template admin). */
async function importTemplateBundleFromUrl(req, res) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = SessionManager.getSessionUser(req.session)
  try {
    const { url, override } = req.body || {}
    if (typeof url !== 'string' || url.trim() === '') {
      return res.status(400).json({ message: t('bundle_url_missing') })
    }
    const privileged = await TemplateAuthorizationHelper.hasTemplateAdminAccess(user, userId)
    const result = await TemplateGalleryManager.importTemplateBundleFromUrl({
      url: url.trim(),
      userId,
      override: !!override,
      privileged,
    })
    return res.json({
      template_id: result.templateId,
      version: result.version,
      created: result.created,
    })
  } catch (error) {
    if (error instanceof TemplateNameConflictError) {
      const ownerName = error.info?.ownerId === userId ? t('you') : error.info?.ownerId || 'unknown'
      return res.status(409).json({
        canOverride: true,
        message: t('template_with_this_title_exists_and_owned_by_x', { x: ownerName }),
      })
    }
    if (error instanceof BundleValidationIssuesError) {
      return res.status(422).json({
        issues: error.issues,
        message: t('bundle_rejected'),
      })
    }
    const status = error.status || 500
    logger.error({ error, url: req.body?.url }, 'template bundle import-from-url failed')
    res.status(status).json({ message: error.message })
  }
}

/** R6 items 5/9: GET /templates/manage — the manage page for template
 *  gallery admins (list + download + import from file/url). */
async function templateAdminPage(req, res, next) {
  const t = req.i18n.translate
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const userIsTemplatesManager = await TemplateAuthorizationHelper.hasTemplateAdminAccess(
      SessionManager.getSessionUser(req.session),
      userId
    )
    res.render(Path.resolve(__dirname, '../views/template_gallery/template-admin'), {
      title: t('Manage template gallery'),
      userIsTemplatesManager,
      ...await themeLocals(req, res),
    })
  } catch (error) {
    next(error)
  }
}

export default {
  createTemplateFromProject,
  getCategoriesJSON,
  getAdminTemplateListJSON,
  editTemplate,
  deleteTemplate,
  getTemplatePreview,
  templatesCategoryPage,
  templateDetailsPage,
  getTemplateJSON,
  getCategoryTemplatesJSON,
  downloadTemplateBundle,
  importTemplateBundle,
  importTemplateBundleFromUrl,
  templateAdminPage,
}
