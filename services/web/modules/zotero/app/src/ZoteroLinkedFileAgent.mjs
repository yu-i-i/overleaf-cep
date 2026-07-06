import logger from '@overleaf/logger'
import { callbackify } from '@overleaf/promise-utils'
import { Project } from '../../../../app/src/models/Project.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import {
   NotFoundError,
   TooManyRequestsError,
   ServiceNotConfiguredError,
   ForbiddenError
} from '../../../../app/src/Features/Errors/Errors.js'
import LinkedFilesHandler from '../../../../app/src/Features/LinkedFiles/LinkedFilesHandler.mjs'
import LinkedFilesErrors from '../../../../app/src/Features/LinkedFiles/LinkedFilesErrors.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'

/**
 * Create a linked .bib file from Zotero (either My Library or a Group Library).
 *
 * linkedFileData shape:
 *   {
 *     provider: 'zotero'
 *     zoteroGroupId?: string
 *     importedAt: Date | string
 *     importedByUserId: string
 *     importedByName: string
 *     bibFormat: 'bibtex' || 'biblatex'
 *   }
 *
 *  - If zoteroGroupId is present, export that group's library.
 *  - Otherwise, export the user's personal library ("My Library").
 */
async function createLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {

  linkedFileData.importedByUserId = userId
  linkedFileData.importedByName = await _getUserName(userId) || 'Unknown'

  logger.debug(
    { projectId, userId, linkedFileData },
    'creating Zotero linked file'
  )

  const bibtex = await _getBibtex(linkedFileData)

  const file = await LinkedFilesHandler.promises.importContent(
    projectId,
    bibtex,
    _sanitizeData(linkedFileData),
    name,
    parentFolderId,
    userId
  )
  return file._id
}

/**
 * Refresh an existing Zotero linked .bib file.
 */
async function refreshLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {
  logger.debug(
    { projectId, userId, linkedFileData },
    'refreshing Zotero linked file'
  )

// refresh importer's displayed name
// if the importer is the owner, name is not displayed, refresh is not needed
// if the importer is not available, the old name is preserved
  const userName = await _getUserName(linkedFileData.importedByUserId)
  if (userName && linkedFileData.importedByUserId != userId) {
    linkedFileData.importedByName = userName
    const { element, path } = await ProjectLocator.promises.findElement({
      project_id: projectId,
      element_id: parentFolderId,
      type: 'folders'
    })
    const fileIndex = element.fileRefs.findIndex(file => file.name === name)
    const updatePath = `${path.mongo}.fileRefs.${fileIndex}.linkedFileData.importedByName`
    await Project.updateOne({ _id: projectId }, { $set: { [updatePath]: userName } })
  }

  const bibtex = await _getBibtex(linkedFileData)

  const file = await LinkedFilesHandler.promises.importContent(
    projectId,
    bibtex,
    _sanitizeData(linkedFileData),
    name,
    parentFolderId,
    userId
  )
  return file._id
}

async function _getBibtex(linkedFileData) {
  const userId = linkedFileData.importedByUserId
  try {
    return await ZoteroApiClient.getLibraryBibtex(
      userId,
      linkedFileData.zoteroGroupId,  // == null for main library
      linkedFileData.bibFormat || 'bibtex'
    )
  } catch (err) {

    if (err instanceof ForbiddenError) {
      logger.debug({ linkedFileData, err }, 'Zotero access denied')
      throw new LinkedFilesErrors.AccessDeniedError('Zotero access denied').withCause(err)
    }
    if (err instanceof ServiceNotConfiguredError) {
      logger.debug({ userId: linkedFileData.importedByUserId, err }, 'Zotero account not linked')
      throw new LinkedFilesErrors.AccessDeniedError('Zotero account not linked').withCause(err)
    }
    if (err instanceof NotFoundError) {
      logger.debug({ group: linkedFileData.zoteroGroupId, err }, 'Zotero group is not found')
      throw new LinkedFilesErrors.SourceFileNotFoundError('Zotero group is not found').withCause(err)
    }
    logger.error({ linkedFileData, err }, 'failed to retrieve bib file from Zotero')
    throw new LinkedFilesErrors.RemoteServiceError('Error retrieving bib file from Zotero').withCause(err)
  }
}

function _sanitizeData(data) {
  return {
    provider: 'zotero',
    ...(data.zoteroGroupId && {
      zoteroGroupId: data.zoteroGroupId,
    }),
    importedAt: data.importedAt,
    ...(data.importedByUserId && {
      importedByUserId: data.importedByUserId,
    }),
    importedByName: data.importedByName || 'Unknown',
    bibFormat: (data.bibFormat === 'biblatex') ? 'biblatex' : 'bibtex'
  }
}

async function _getUserName(userId) {
  let user = null
  try {
    user = await UserGetter.promises.getUser(userId, {'email': 1, 'first_name': 1, 'last_name': 1})
  }
  catch (err) {
    logger.error({ userId, err }, 'failed to get user info')
  }
  if (!user) return null

  const { email, first_name, last_name } = user
  const name = (first_name || last_name) ?
    [first_name, last_name].filter(n => n != null).join(' ') : email
  return name
}

export default {
  createLinkedFile: callbackify(createLinkedFile),
  refreshLinkedFile: callbackify(refreshLinkedFile),
  promises: { createLinkedFile, refreshLinkedFile }
}
