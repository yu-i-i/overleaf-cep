import Settings from '@overleaf/settings'
import OError from '@overleaf/o-error'
import { fetchJson, fetchStream } from '@overleaf/fetch-utils'
import HistoryManager from '../../../../../app/src/Features/History/HistoryManager.mjs'

const urlBase = `${Settings.apis.project_history.url}/project`

async function latestVersion(projectId) {
  const url = `${urlBase}/${projectId}/version`
  try {
    await HistoryManager.promises.flushProject(projectId)
    const json = await fetchJson(url)
    return json.version
  } catch (err) {
    throw OError.tag(err, 'Failed to get the latest project version from history', { projectId })
  }
}

// /updates is paginated by timestamp, not version. Fetch enough pages to
// include the boundary instead of treating the first (newest) page as complete.
async function getUpdatesSince(projectId, version) {
  const updates = []
  let before
  try {
    while (true) {
      const url = new URL(`${urlBase}/${projectId}/updates`)
      url.searchParams.set('min_count', '1')
      if (before != null) url.searchParams.set('before', before)
      const json = await fetchJson(url)
      if (!Array.isArray(json.updates)) throw new Error('Invalid history updates response')
      updates.push(...json.updates)
      if (json.updates.some(update => update.fromV <= version && update.toV > version)) break

      const next = json.nextBeforeTimestamp
      if (next == null) break
      if (!Number.isFinite(next) || before != null && next >= before) {
        throw new Error('Invalid history updates pagination')
      }
      before = next
    }
    return updates.filter(update => update.toV > version)
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch the project updates since version', { projectId, version })
  }
}

async function getProjectSnapshot(projectId, version) {
  const url = `${urlBase}/${projectId}/version/${version}`
  try {
    const snapshot = await fetchJson(url)
    if (!snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files)) {
      throw new Error('Invalid project snapshot response')
    }
    return snapshot.files
  } catch (err) {
    throw OError.tag(err, 'Failed to get the project snapshot from history', { projectId })
  }
}

async function getPathsAtVersion(projectId, version) {
  const url = `${urlBase}/${projectId}/paths/version/${version}`
  try {
    const json = await fetchJson(url)
    if (!Array.isArray(json.paths)) throw new Error('Invalid project paths response')
    return json
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch file paths from history', { projectId, version })
  }
}

// response field 'diff' is an array of objects:
// {
//   pathname: string,
//   operation: 'added' | 'removed' | 'edited'| 'renamed' | undefined,
//   ...
// }
async function getProjectFileTreeDiff(projectId, fromV, toV) {
  const url = `${urlBase}/${projectId}/filetree/diff?from=${fromV}&to=${toV}`
  try {
    const json = await fetchJson(url)
    if (!Array.isArray(json.diff)) throw new Error('Invalid project filetree diff response')
    return json.diff
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch filetree diff from history', { projectId, fromV, toV })
  }
}

// return file from history as a base64 encoded string
async function getProjectFileBuffer(projectId, version, filePath) {
  const url = `${urlBase}/${projectId}/version/${version}/${encodeURIComponent(filePath)}`
  try {
    const stream = await fetchStream(url)
    return await _streamToBase64(stream)
  } catch (err) {
    throw OError.tag(err, 'Failed to fetch file from history', { projectId, version, filePath })
  }
}

async function _streamToBase64(stream) {
  const parts = []
  let leftover = null

  for await (const chunk of stream) {
    const data = leftover ? Buffer.concat([leftover, chunk]) : chunk

    const remainder = data.length % 3
    const completeLength = data.length - remainder

    if (completeLength > 0) {
      parts.push(data.subarray(0, completeLength).toString('base64'))
    }

    leftover = remainder ? data.subarray(completeLength) : null
  }

  if (leftover) {
    parts.push(leftover.toString('base64'))
  }

  return parts.join('')
}

export default {
  latestVersion,
  getUpdatesSince,
  getPathsAtVersion,
  getProjectSnapshot,
  getProjectFileBuffer,
  getProjectFileTreeDiff,
}
