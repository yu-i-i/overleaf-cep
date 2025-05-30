import logger from '@overleaf/logger'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.js'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.js'
import TemplateGalleryManager from'./TemplateGalleryManager.mjs'
import { getUserName } from './TemplateGalleryHelper.mjs'
import { TemplateNameConflictError, RecompileRequiredError } from './TemplateErrors.mjs'
import Settings from '@overleaf/settings'

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

async function templatesCategoryPage(req, res, next) {
  const t = req.i18n.translate
  try {
    let { category } = req.params
    const result = await TemplateGalleryManager.getTemplatesPageData(category)

    let title
    if (result.categoryName) {
      title = t('latex_templates') + ' — ' + result.categoryName
    } else {
      category = null
      title = t('templates_page_title')
    }
    res.render('template_gallery/template-gallery', {
      title,
      category,
    })
  } catch (error) {
    next(error)
  }
}

async function templateDetailsPage(req, res, next) {
  const t = req.i18n.translate
  try {
    const template = await TemplateGalleryManager.getTemplate('_id', req.params.template_id)
    res.render('template_gallery/template', {
      title: `${t('template')}: ${template.name}`,
      template: JSON.stringify(template),
      languages: Settings.languages,
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

export default {
  createTemplateFromProject,
  editTemplate,
  deleteTemplate,
  getTemplatePreview,
  templatesCategoryPage,
  templateDetailsPage,
  getTemplateJSON,
  getCategoryTemplatesJSON,
}
