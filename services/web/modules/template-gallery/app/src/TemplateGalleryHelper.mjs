import MarkdownIt from 'markdown-it'
import request from 'request'
import logger from '@overleaf/logger'
import settings from '@overleaf/settings'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.js'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.js'
import ProjectZipStreamManager from '../../../../app/src/Features/Downloads/ProjectZipStreamManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.js'
import ClsiManager from '../../../../app/src/Features/Compile/ClsiManager.js'
import CompileManager from '../../../../app/src/Features/Compile/CompileManager.js'
import UserGetter from '../../../../app/src/Features/User/UserGetter.js'
import { fetchStreamWithResponse } from '@overleaf/fetch-utils'
import { Template } from './models/Template.js'
import { RecompileRequiredError } from './TemplateErrors.mjs'
import { cleanHtml }  from './CleanHtml.mjs'

const TIMEOUT = 30000

const MAX_PROJECT_NAME_LENGTH = 150
const MAX_FORM_INPUT_LENGTH = 512
const MAX_TEMPLATE_DESCRIPTION_LENGTH = 4096

const markdownIt = new MarkdownIt({ html: false, linkify: true })

function _createZipStreamForProjectAsync(projectId) {
  return new Promise((resolve, reject) => {
    ProjectZipStreamManager.createZipStreamForProject(projectId, (err, archive) => {
      if (err) {
        return reject(err)
      }
      archive.on('error', (err) => reject(err))
      resolve(archive)
    })
  })
}

export function validateTemplateInput({ name, descriptionMD, authorMD, license }) {
  if (name?.length > MAX_PROJECT_NAME_LENGTH) {
    throw new Errors.InvalidNameError(`Template title exceeds the maximum length of ${MAX_PROJECT_NAME_LENGTH} characters.`)
  }
  if (descriptionMD?.length > MAX_TEMPLATE_DESCRIPTION_LENGTH) {
    throw new Errors.InvalidNameError(`Template description exceeds the maximum length of ${MAX_TEMPLATE_DESCRIPTION_LENGTH} characters.`)
  }
  if (authorMD?.length > MAX_FORM_INPUT_LENGTH) {
    throw new Errors.InvalidNameError('Author name is too long.')
  }
  if (license?.length > MAX_FORM_INPUT_LENGTH) {
    throw new Errors.InvalidNameError('License name is too long.')
  }
}

export async function canUserOverrideTemplate(template, userId) {
  let templateOwnerId = template.owner
  let templateOwnerName = 'you'
  let userIsOwner = true
  let userIsAdmin
  if (templateOwnerId != userId) {
    userIsOwner = false
    try {
      userIsAdmin = (await UserGetter.promises.getUser(userId, { isAdmin: 1 })).isAdmin
    } catch {
      logger.error({ error, userId }, 'Logged in user does not exist, strange...')
      userIsAdmin = false
    }
    templateOwnerName = await getUserName(templateOwnerId) || 'unknown'
  }
  const canOverride = userIsOwner || userIsAdmin
  return { canOverride, templateOwnerName }
}

export async function getUserName(userId) {
  try {
    const user = await UserGetter.promises.getUser(userId, {
      first_name: 1,
      last_name: 1,
    })
    return ((user?.first_name || "") + " " + (user?.last_name || "")).trim()
  } catch (error) {
    return 'unknown'
  }
}

export async function generateTemplateData(projectId, {
  descriptionMD,
  authorMD,
  category,
  license,
  name,
}) {
  try {
    await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

    const project = await ProjectGetter.promises.getProject(projectId, {
      imageName: true,
      compiler: true,
      spellCheckLanguage: true,
      rootDoc_id: true,
      rootFolder: true,
    })

    const { path } = await ProjectLocator.promises.findRootDoc({ project })
    const mainFile = path.fileSystem.replace(/^\/+/, '')
    const template = {
      name,
      category,
      authorMD,
      descriptionMD,
      license,
      mainFile,
      compiler: project.compiler,
      imageName: project.imageName,
      language: project.spellCheckLanguage,
      lastUpdated: new Date(),
    }

    await renderTemplateHtmlFields(template)
    return template
  } catch (error) {
    logger.error({ error, projectId }, 'Failed to retrieve project data')
    throw error
  }
}

export async function uploadTemplateAssets(projectId, userId, build, template) {
  let zipStream, pdfStream
  try {
    [zipStream, pdfStream] = await Promise.all([
      _createZipStreamForProjectAsync(projectId),
      CompileManager.promises
        .getProjectCompileLimits(projectId)
        .then((limits) =>
          ClsiManager.promises.getOutputFileStream(projectId, userId, limits, undefined, build, 'output.pdf')
        )
    ])
  } catch (error) {
    logger.error({ error, projectId }, 'No output.pdf?')
    throw new RecompileRequiredError()
  }
  try {
    const templateUrl = `${settings.apis.filestore.url}/template/${template._id}/v/${template.version}`
    const zipUrl = `${templateUrl}/zip`
    const pdfUrl = `${templateUrl}/pdf`
    const [zipReq, pdfReq] = await Promise.all([
      fetchStreamWithResponse(zipUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: zipStream,
        signal: AbortSignal.timeout(TIMEOUT),
      }),
      fetchStreamWithResponse(pdfUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
        },
        body: pdfStream,
        signal: AbortSignal.timeout(TIMEOUT),
      }),
    ])
    const uploadErrors = []
    if (zipReq?.response.status !== 200) {
      uploadErrors.push({ file: 'zip', uri: zipUrl, statusCode: zipReq.response.status })
    }
    if (pdfReq?.response.status !== 200) {
      uploadErrors.push({ file: 'pdf', uri: pdfUrl, statusCode: pdfReq.response.status })
    }
    if (uploadErrors.length > 0) {
      logger.error({ uploadErrors }, 'Template upload failed')
      throw new RecompileRequiredError()
    }
  } catch (error) {
    if (error instanceof RecompileRequiredError) throw error
    throw error
  }
}

export async function deleteTemplateAssets(templateId, version, deleteFromDb) {
  if (deleteFromDb) {
    try {
      await Template.deleteOne({ _id: templateId }).exec()
    } catch (error) {
      logger.error({ err, templateId }, 'Failed to delete template from MongoDB')
      throw error
    }
  }

  // kick off file deletions, but don't wait
  const baseUrl = settings.apis.filestore.url
  const urlTemplate = `${baseUrl}/template/${templateId}/v/${version}/zip`
  const urlImages = `${baseUrl}/template/${templateId}/v/${version}/pdf`

  const optsTemplate = {
    method: 'DELETE',
    uri: urlTemplate,
    timeout: TIMEOUT,
  }

  const optsImages = {
    method: 'DELETE',
    uri: urlImages,
    timeout: TIMEOUT,
  }

  request(optsTemplate, (err, response) => {
    if (err)
      logger.warn({ err, templateId }, 'Failed to delete template zip from filestore')
  })

  request(optsImages, (err, response) => {
    if (err)
      logger.warn({ err, templateId }, 'Failed to delete images from filestore')
  })
}

export function renderTemplateHtmlFields(updates) {
  if (updates.descriptionMD !== undefined) {
    const descriptionRawHTML = markdownIt.render(updates.descriptionMD)
    updates.description = cleanHtml(descriptionRawHTML, "reachText")
  }
  if (updates.authorMD !== undefined) {
    const authorRawHTML = markdownIt.render(updates.authorMD)
    updates.author = cleanHtml(authorRawHTML, "linksOnly")
  }
}
