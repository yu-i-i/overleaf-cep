// Helper functions used by GitBridgeController.

import path from 'path'
import settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { fetchJson } from '@overleaf/fetch-utils'
import { fetchStream } from '@overleaf/fetch-utils'

import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import UpdateMerger from '../../../../app/src/Features/ThirdPartyDataStore/UpdateMerger.mjs'

const PROJECT_HISTORY = settings.apis.project_history.url

function normalizeAndValidateFilePath(fileName) {
  if (!fileName || fileName.includes('\0')) return null

  const normalized = path.posix.normalize(fileName)

  if (normalized.startsWith('/') || normalized.startsWith('..')) return null
  if (normalized === '.git' || normalized.startsWith('.git/')) return null

  return normalized
}   

function validateFileName(fileName) {
  const normalized = normalizeAndValidateFilePath(fileName)

// if normalized path is not acceptable: error
// if normalized path differs from original: suggest rename
// otherwise the filename is valid
  if (!normalized) {
    return { file: fileName, state: 'error' }
  }
  if (normalized !== fileName) {
    return { file: fileName, cleanFile: normalized }
  }
  return null
}

// Push update to Overleaf.
// update is an array of objects: { name: string, url: string | null }, provided by git-bridge
//   name: file path in the new project version (without leading '/')
//   url: download link from git-bridge, null means the file has not changed
// Any existing entities whose paths are not present in update must be deleted.
// Note: entity paths returned by ProjectEntityHandler include a leading '/'

async function pushUpdate(projectId, update, postbackUrl, userId) {

  const invalidFiles = []

  update.forEach(file => {
    const validationError = validateFileName(file.name)
    if (validationError) invalidFiles.push(validationError)
  })

  if (invalidFiles.length > 0) {
    await postback(postbackUrl, { code: 'invalidFiles', errors: invalidFiles  })
    return
  }

  try {
    const { docs, files } = await ProjectEntityHandler.promises.getAllEntities(projectId)

    const entityPaths = [...docs.map(d => d.path), ...files.map(f => f.path)]
    // prepend '/', paths in the entities have it
    const pathsInUpdate = new Set(update.map(f => '/' + f.name))

    // Entities present in the project but missing in the update must be deleted
    const deletedPaths = entityPaths.filter(p => !pathsInUpdate.has(p))

    for (const path of deletedPaths) {
      await UpdateMerger.promises.deleteUpdate(userId, projectId, path, 'git-bridge')
    }

    // Apply file updates received from git-bridge
    for (const file of update) {
      if (!file.url) continue

      const stream = await fetchStream(file.url)
      const fileName = '/' + file.name
      await UpdateMerger.promises.mergeUpdate(userId, projectId, fileName, stream, 'git-bridge')
    }

  } catch (err) {
    await postback(postbackUrl, { code: 'error' })
    throw err
  }

  const { version } = await fetchJson(`${PROJECT_HISTORY}/project/${projectId}/version`)
  await postback(postbackUrl, { code: 'upToDate', latestVerId: version })
}

/*
Postback expected data:

Success: { code: "upToDate", latestVerId: number }
  latestVerId is a new version ID created by the push

Error: 
{ 
  code: "invalidFiles",
  errors: [
    {
      file: "path/to/file",
      cleanFile: "suggested_name"
    },
    {
      file: "path/to/file",
      state: "disallowed"
    }
  ]
}
  cleanFile is interpreted as a sanitized replacement filename
  state "disallowed": git bridge gives a hint "wrong file extension" (not used)

Error: { code: "error" }
  Generic error.

Error (not used): { code: "outOfDate" }
  The pushed snapshot was based on an outdated version.
  It can be used when the snapshot was accepted initially, 
  but later processing discovered the base version was outdated.

Error (not used): 
{
  code: "invalidProject",
  errors: [
    "error message 1",
    "error message 2"
  ]
}

*/

async function postback(postbackUrl, code) {

  try {
    await fetchJson(postbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(code),
    })

  } catch (err) {
    logger.error({ err, postbackUrl, code }, 'Failed to post back to git-bridge')

  }
}

export default {
  normalizeAndValidateFilePath,
  pushUpdate,
}
