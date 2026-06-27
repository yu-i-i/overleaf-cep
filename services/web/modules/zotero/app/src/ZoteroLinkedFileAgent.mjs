import logger from '@overleaf/logger'
import { callbackify } from '@overleaf/promise-utils'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import LinkedFilesHandler from '../../../../app/src/Features/LinkedFiles/LinkedFilesHandler.mjs'
import LinkedFilesErrors from '../../../../app/src/Features/LinkedFiles/LinkedFilesErrors.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import { ZoteroForbiddenError, ZoteroAccountNotLinkedError } from './ZoteroApiClient.mjs'

const {
  AccessDeniedError,
  RemoteServiceError,
} = LinkedFilesErrors

/**
 * Create a linked .bib file from Zotero (either My Library or a Group Library).
 *
 * linkedFileData shape:
 *   {
 *     provider: 'zotero'
 *     zoteroGroupId?: string
 *     importedAt: Date | string
 *     importedByUserId?: string
 *     importedByName?: string
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
  logger.debug(
    { projectId, userId, groupId: linkedFileData.zoteroGroupId },
    'creating Zotero linked file'
  )

  linkedFileData.importedByUserId = userId
  linkedFileData.importedByName = await _getUserName(userId)

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
    { projectId, userId, groupId: linkedFileData.zoteroGroupId },
    'refreshing Zotero linked file'
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

async function _getBibtex(linkedFileData) {
  const userId = linkedFileData.importedByUserId
  try {
    if (linkedFileData.zoteroGroupId) {
      return await ZoteroApiClient.getGroupLibraryBibtex(
        userId,
        linkedFileData.zoteroGroupId
      )
    } else {
      return await ZoteroApiClient.getUserLibraryBibtex(userId)
    }
  } catch (err) {
    if (err instanceof ZoteroForbiddenError) {
      throw new AccessDeniedError('Zotero access denied').withCause(err)
    }
    if (err instanceof ZoteroAccountNotLinkedError) {
      throw new AccessDeniedError('Zotero account not linked').withCause(err)
    }
    throw new RemoteServiceError('Zotero API error').withCause(err)
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
  if (!user) return 'Unknown'

  const { email, first_name, last_name } = user
  const name = (first_name || last_name) ?
    [first_name, last_name].filter(n => n != null).join(' ') : email
  return name || 'Unknown'
}

export default {
  createLinkedFile: callbackify(createLinkedFile),
  refreshLinkedFile: callbackify(refreshLinkedFile),
  promises: { createLinkedFile, refreshLinkedFile }
}
