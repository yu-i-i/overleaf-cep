import logger from '@overleaf/logger'
import { callbackify } from '@overleaf/promise-utils'
import LinkedFilesHandler from '../../../../app/src/Features/LinkedFiles/LinkedFilesHandler.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import { ZoteroForbiddenError } from './ZoteroApiClient.mjs'
import LinkedFilesErrors from '../../../../app/src/Features/LinkedFiles/LinkedFilesErrors.mjs'

const { FeatureNotAvailableError, AccessDeniedError, RemoteServiceError } =
  LinkedFilesErrors

/**
 * Create a linked .bib file from Zotero (either My Library or a Group Library).
 *
 * linkedFileData shape:
 *   { provider: 'zotero', zoteroGroupId?: string, importedAt: string }
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
  logger.info(
    { projectId, userId, groupId: linkedFileData.zoteroGroupId },
    'creating Zotero linked file'
  )

  const bibtex = await _getBibtex(userId, linkedFileData)

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
  logger.info(
    { projectId, userId, groupId: linkedFileData.zoteroGroupId },
    'refreshing Zotero linked file'
  )

  const bibtex = await _getBibtex(userId, linkedFileData)

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

async function _getBibtex(userId, linkedFileData) {
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
    throw new RemoteServiceError('Zotero API error').withCause(err)
  }
}

function _sanitizeData(data) {
  return {
    provider: 'zotero',
    zoteroGroupId: data.zoteroGroupId || undefined,
    importedAt: data.importedAt,
  }
}

export default {
  createLinkedFile: callbackify(createLinkedFile),
  refreshLinkedFile: callbackify(refreshLinkedFile),
  promises: { createLinkedFile, refreshLinkedFile },
}
