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
 *     group_id: string | null
 *     importedAt: Date | string
 *     importer_id: string
 *     importer_name: string
 *     format: 'bibtex' || 'biblatex'
 *   }
 *
 *  - If group_id is present, export that group's library.
 *  - Otherwise, export the user's personal library ("My Library").
 */
async function createLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {

  linkedFileData.importer_id = userId
  linkedFileData.importer_name = await _getUserName(userId) || 'Unknown'

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
  linkedFileData = _normalizeLegacyData(linkedFileData)
  logger.debug(
    { projectId, userId, linkedFileData },
    'refreshing Zotero linked file'
  )

// refresh importer's displayed name
// if the importer is the owner, name is not displayed, refresh is not needed
// if the importer is not available, the old name is preserved
  const userName = await _getUserName(linkedFileData.importer_id)
  if (userName && linkedFileData.importer_id != userId) {
    linkedFileData.importer_name = userName
    const { element, path } = await ProjectLocator.promises.findElement({
      project_id: projectId,
      element_id: parentFolderId,
      type: 'folders'
    })
    const fileIndex = element.fileRefs.findIndex(file => file.name === name)
    const updatePath = `${path.mongo}.fileRefs.${fileIndex}.linkedFileData.importer_name`
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
  const userId = linkedFileData.importer_id
  try {
    return await ZoteroApiClient.getLibraryBibtex(
      userId,
      linkedFileData.group_id,  // == null for main library
      linkedFileData.format || 'bibtex'
    )
  } catch (err) {

    if (err instanceof ForbiddenError) {
      logger.debug({ linkedFileData, err }, 'Zotero access denied')
      throw new LinkedFilesErrors.AccessDeniedError('Zotero access denied').withCause(err)
    }
    if (err instanceof ServiceNotConfiguredError) {
      logger.debug({ userId: linkedFileData.importer_id, err }, 'Zotero account not linked')
      throw new LinkedFilesErrors.AccessDeniedError('Zotero account not linked').withCause(err)
    }
    if (err instanceof NotFoundError) {
      logger.debug({ group: linkedFileData.group_id, err }, 'Zotero group is not found')
      throw new LinkedFilesErrors.SourceFileNotFoundError('Zotero group is not found').withCause(err)
    }
    logger.error({ linkedFileData, err }, 'failed to retrieve bib file from Zotero')
    throw new LinkedFilesErrors.RemoteServiceError('Error retrieving bib file from Zotero').withCause(err)
  }
}

// Files imported before "Zotero: fix for 6.3.0" use the old key names.
function _normalizeLegacyData(data) {
  const {
    zoteroGroupId,
    importedByUserId,
    importedByName,
    bibFormat,
    ...rest
  } = data
  return {
    ...rest,
    group_id: rest.group_id ?? zoteroGroupId ?? null,
    importer_id: rest.importer_id ?? importedByUserId,
    importer_name: rest.importer_name ?? importedByName,
    format: rest.format ?? bibFormat,
  }
}

function _sanitizeData(data) {
  return {
    provider: 'zotero',
    group_id: data.group_id ?? null,
    importedAt: data.importedAt,
    ...(data.importer_id && {
      importer_id: data.importer_id,
    }),
    importer_name: data.importer_name || 'Unknown',
    format: (data.format === 'biblatex') ? 'biblatex' : 'bibtex'
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
