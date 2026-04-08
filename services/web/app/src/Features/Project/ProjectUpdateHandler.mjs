import { Project } from '../../models/Project.mjs'
import { callbackify } from 'node:util'
import Modules from '../../infrastructure/Modules.mjs'

const ProjectUpdateHandler = {
  async markAsUpdated(projectId, lastUpdatedAt, lastUpdatedBy) {
    if (!lastUpdatedAt) {
      lastUpdatedAt = new Date()
    }

    const conditions = {
      _id: projectId,
      lastUpdated: { $lt: lastUpdatedAt },
    }

    const update = {
      lastUpdated: lastUpdatedAt || new Date().getTime(),
      lastUpdatedBy,
    }
    await Project.updateOne(conditions, update, {}).exec()
    Modules.promises.hooks.fire('projectUpdated', projectId).catch(() => {})
  },

  async markAsOpened(projectId) {
    const conditions = { _id: projectId }
    const update = { lastOpened: Date.now() }
    await Project.updateOne(conditions, update, {}).exec()
  },

  async markAsInactive(projectId) {
    const conditions = { _id: projectId }
    const update = { active: false }
    await Project.updateOne(conditions, update, {}).exec()
  },

  async markAsActive(projectId) {
    const conditions = { _id: projectId }
    const update = { active: true }
    await Project.updateOne(conditions, update, {}).exec()
  },

  async setWebDAVConfig(projectId, webdavConfig) {
    const basePath = (webdavConfig.basePath || '/overleaf').replace(/\/$/, '')
    const existing = await Project.findById(projectId, 'webdavConfig').lean().exec()
    const existingConfig = existing?.webdavConfig
    const isBasePathChanged = !existingConfig || existingConfig.basePath !== basePath

    let finalUsername = ''
    let finalPassword = ''
    if (webdavConfig.useUsername) {
      finalUsername = webdavConfig.username || existingConfig?.username || ''
    }
    if (webdavConfig.usePassword) {
      finalPassword = webdavConfig.password || existingConfig?.password || ''
    }

    await Project.updateOne(
      { _id: projectId },
      {
        $set: {
          webdavConfig: {
            url: webdavConfig.url,
            username: finalUsername,
            password: finalPassword,
            basePath,
            enabled: true,
            lastSyncDate: isBasePathChanged ? null : (existingConfig?.lastSyncDate || null),
            syncedFileHashes: isBasePathChanged ? {} : (existingConfig?.syncedFileHashes || {}),
          },
        },
      }
    ).exec()
  },

  async unsetWebDAVConfig(projectId) {
    await Project.updateOne(
      { _id: projectId },
      { $unset: { webdavConfig: '' } }
    ).exec()
  },
}

export default {
  markAsUpdated: callbackify(ProjectUpdateHandler.markAsUpdated),
  markAsOpened: callbackify(ProjectUpdateHandler.markAsOpened),
  markAsInactive: callbackify(ProjectUpdateHandler.markAsInactive),
  markAsActive: callbackify(ProjectUpdateHandler.markAsActive),
  setWebDAVConfig: callbackify(ProjectUpdateHandler.setWebDAVConfig),
  unsetWebDAVConfig: callbackify(ProjectUpdateHandler.unsetWebDAVConfig),
  promises: ProjectUpdateHandler,
}
