import { Project } from '../../models/Project.js'
import ProjectDetailsHandler from '../Project/ProjectDetailsHandler.mjs'
import ProjectOptionsHandlerModule from '../Project/ProjectOptionsHandler.js'
import ProjectRootDocManagerModule from '../Project/ProjectRootDocManager.mjs'
import ProjectUploadManager from '../Uploads/ProjectUploadManager.mjs'
import fs from 'node:fs'
import util from 'node:util'
import logger from '@overleaf/logger'
import {
  fetchJson,
  fetchStreamWithResponse,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import settings from '@overleaf/settings'
import crypto from 'node:crypto'
import Errors from '../Errors/Errors.js'
import { pipeline } from 'node:stream/promises'
import ClsiCacheManager from '../Compile/ClsiCacheManager.mjs'

const { promises: ProjectRootDocManager } = ProjectRootDocManagerModule
const { promises: ProjectOptionsHandler } = ProjectOptionsHandlerModule
const TIMEOUT = 30000  // 30 sec

const TemplatesManager = {
  async createProjectFromV1Template(
    brandVariationId,
    compiler,
    mainFile,
    templateId,
    templateName,
    templateVersionId,
    userId,
    imageName,
    language
  ) {
    const zipUrl = `${settings.apis.filestore.url}/template/${templateId}/v/${templateVersionId}/zip`
    const zipReq = await fetchStreamWithResponse(zipUrl, {
      signal: AbortSignal.timeout(TIMEOUT),
    })

    const projectName = ProjectDetailsHandler.fixProjectName(templateName)
    const dumpPath = `${settings.path.dumpFolder}/${crypto.randomUUID()}`
    const writeStream = fs.createWriteStream(dumpPath)
    try {
      const attributes = {}
      await pipeline(zipReq.stream, writeStream)

      if (zipReq.response.status !== 200) {
        logger.warn(
          { uri: zipUrl, statusCode: zipReq.response.status },
          'non-success code getting zip from template API'
        )
        throw new Error(`get zip failed: ${zipReq.response.status}`)
      }
      const project =
        await ProjectUploadManager.promises.createProjectFromZipArchiveWithName(
          userId,
          projectName,
          dumpPath,
          attributes
        )

      const prepareClsiCacheInBackground = ClsiCacheManager.prepareClsiCache(
        project._id,
        userId,
        { templateId, templateVersionId }
      ).catch(err => {
        logger.warn(
          { err, templateId, templateVersionId, projectId: project._id },
          'failed to prepare clsi-cache from template'
        )
      })

      await TemplatesManager._setCompiler(project._id, compiler)
      await TemplatesManager._setImage(project._id, imageName)
      await TemplatesManager._setMainFile(project._id, mainFile)
      await TemplatesManager._setSpellCheckLanguage(project._id, language)
      await TemplatesManager._setBrandVariationId(project._id, brandVariationId)

      await prepareClsiCacheInBackground

      return project
    } finally {
      await fs.promises.unlink(dumpPath)
    }
  },

  async _setCompiler(projectId, compiler) {
    if (compiler == null) {
      return
    }
    await ProjectOptionsHandler.setCompiler(projectId, compiler)
  },

  async _setImage(projectId, imageName) {
    try {
      await ProjectOptionsHandler.setImageName(projectId, imageName)
    } catch {
      logger.warn({ imageName: imageName }, 'not available')
      await ProjectOptionsHandler.setImageName(projectId, process.env.TEX_LIVE_DOCKER_IMAGE)
    }
  },

  async _setMainFile(projectId, mainFile) {
    if (mainFile == null) {
      return
    }
    await ProjectRootDocManager.setRootDocFromName(projectId, mainFile)
  },

  async _setSpellCheckLanguage(projectId, language) {
    if (language == null) {
      return
    }
    await ProjectOptionsHandler.setSpellCheckLanguage(projectId, language)
  },

  async _setBrandVariationId(projectId, brandVariationId) {
    if (brandVariationId == null) {
      return
    }
    await ProjectOptionsHandler.setBrandVariationId(projectId, brandVariationId)
  },

  async fetchFromV1(templateId) {
    const url = new URL(`/api/v2/templates/${templateId}`, settings.apis.v1.url)

    try {
      return await fetchJson(url, {
        basicAuth: {
          user: settings.apis.v1.user,
          password: settings.apis.v1.pass,
        },
        signal: AbortSignal.timeout(settings.apis.v1.timeout),
      })
    } catch (err) {
      if (err instanceof RequestFailedError && err.response.status === 404) {
        throw new Errors.NotFoundError()
      } else {
        throw err
      }
    }
  },
}

export default {
  promises: TemplatesManager,
  createProjectFromV1Template: util.callbackify(
    TemplatesManager.createProjectFromV1Template
  ),
  fetchFromV1: util.callbackify(TemplatesManager.fetchFromV1),
}
