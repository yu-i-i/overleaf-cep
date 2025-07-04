const path = require('path')
const SessionManager = require('../Authentication/SessionManager')
const TemplatesManager = require('./TemplatesManager')
const ProjectHelper = require('../Project/ProjectHelper')
const logger = require('@overleaf/logger')
const { expressify } = require('@overleaf/promise-utils')

const TemplatesController = {
  async getV1Template(req, res) {
    const templateId = req.params.Template_version_id
    const templateVersionId = req.query.version
//    if (!/^[0-9]+$/.test(templateVersionId) || !/^[0-9]+$/.test(templateId)) {
//      logger.err(
//        { templateVersionId, templateId },
//        'invalid template id or version'
//      )
//      return res.sendStatus(400)
//    }
    const data = {
      templateVersionId,
      templateId,
      name: req.query.name,
      compiler: req.query.compiler,
      language: req.query.language,
      imageName: req.query.imageName,
      mainFile: req.query.mainFile,
      brandVariationId: req.query.brandVariationId,
    }
    res.render(
      path.resolve(
        __dirname,
        '../../../views/project/editor/new_from_template'
      ),
      data
    )
  },

  async createProjectFromV1Template(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)

    const project = await TemplatesManager.promises.createProjectFromV1Template(
      req.body.brandVariationId,
      req.body.compiler,
      req.body.mainFile,
      req.body.templateId,
      req.body.templateName,
      req.body.templateVersionId,
      userId,
      req.body.imageName,
      req.body.language
    )
    delete req.session.templateData
    if (!project) {
      throw new Error('failed to create project from template')
    }
    return res.redirect(`/project/${project._id}`)
  },
}

module.exports = {
  getV1Template: expressify(TemplatesController.getV1Template),
  createProjectFromV1Template: expressify(
    TemplatesController.createProjectFromV1Template
  ),
}
