// Controller for API v0 endpoints used by git-bridge
// These endpoints allow git-bridge to access project metadata, versions, and snapshots.

import settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { fetchJson } from '@overleaf/fetch-utils'

import JsonWebToken from '../../../../app/src/infrastructure/JsonWebToken.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import HistoryController from '../../../../app/src/Features/History/HistoryController.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import GitBridgeHandler from './GitBridgeHandler.mjs'

const PROJECT_HISTORY = settings.apis.project_history.url
const V1_HISTORY = settings.apis.v1_history.url

/*
  Entrypoint (GET): /api/v0/docs/:project_id
  Called by git-bridge to retrieve metadata about the latest project version.

  The response must contain:
  {
    latestVerId: number,
    latestVerAt: string,
    latestVerBy: { email: string, name: string }
  }

  This data is retrieved from the project-history service:
  /project/${projectId}/version
*/

async function getDoc(req, res, next) {

  const projectId = req.params.project_id

  try {
    const project = await ProjectGetter.promises.getProject(projectId, { _id: 1 })
    if (!project) throw new Error('Project not found')

    const latestVerInfo = await fetchJson(`${PROJECT_HISTORY}/project/${projectId}/version`)
    const timestamp = latestVerInfo.timestamp || new Date().toISOString()
    const userId = latestVerInfo.v2Authors && latestVerInfo.v2Authors[0]

    let user = null
    if (userId) {
      user = await UserGetter.promises.getUser(userId, { first_name: 1, last_name: 1, email: 1 })
    }

    const name = HistoryController._displayNameForUser(user)
    const email = user?.email || 'anonymous@nowhere'

    res.json({
      latestVerId: latestVerInfo.version,
      latestVerAt: timestamp,
      latestVerBy: { email, name },
    })
  } catch (err) {
    logger.error({ err, projectId }, 'Error retrieving the latest version metadata')
    return res.sendStatus(400)
  }
}

/*
  Entrypoint (GET): /api/v0/docs/:project_id/saved_vers
  Called by git-bridge to retrieve metadata about labeled (saved) versions.

  The response must be an array of objects:
  {
    versionId: number,
    comment: string,
    createdAt: timestamp,
    user: { email: string, name: string }
  }

  This data is retrieved from the project-history service:
  /project/${projectId}/labels
*/

async function getSavedVers(req, res, next) {

  const projectId = req.params.project_id

  try {
    const project = await ProjectGetter.promises.getProject(projectId, { _id: 1 })
    if (!project) throw new Error('Project is not found')

    let labels = await fetchJson(`${PROJECT_HISTORY}/project/${projectId}/labels`)

    const userIdSet = new Set(labels.map(label => label.user_id))
    // For backward compatibility: labels created anonymously may not contain user_id
    userIdSet.delete(undefined)
    const users = await UserGetter.promises.getUsers(Array.from(userIdSet), { first_name: 1, last_name: 1, email: 1 })

    const savedVers = []
    labels.forEach(label => {
      const user = users.find(u => String(u._id) === label.user_id)
      const name = HistoryController._displayNameForUser(user)
      const email = user?.email || 'anonymous@nowhere'
      savedVers.push({
        versionId: label.version,
        comment: label.comment,
        createdAt: label.created_at,
        user: { name, email },
      })
    })

    res.json(savedVers)

  } catch (err) {
    logger.error({ err, projectId }, 'Error retrieving the saved versions metadata')
    return res.sendStatus(400)
  }
}

/*
  Entrypoint (GET): /api/v0/docs/:project_id/snapshots/:version
  Called by git-bridge to retrieve a full project snapshot for a specific version.

  Needs in the response the following object:
  {
    srcs: [ [ fileContent: string, pathname: string ], ... ],
    atts: [ [ downloadUrl: string, pathname: string ], ... ],
  }

  This data is retrieved from the project-history service:
  entrypoint: /project/${projectId}/version/${version}
*/

async function getSnapshot(req, res, next) {

  const projectId = req.params.project_id
  const versionString = req.params.version

  try {
    if (!versionString) throw new Error('No version specified')
    const version = Number(versionString)

    const project = await ProjectGetter.promises.getProject(projectId, { _id: 1 })
    if (!project) throw new Error('Project not found')

    const snapshot = await fetchJson(`${PROJECT_HISTORY}/project/${projectId}/version/${version}`)
    const files = snapshot.files || {}

    const srcs = []
    const atts = []

    for (const [pathname, file] of Object.entries(files)) {
      if (!file?.data) continue

      if (!GitBridgeHandler.normalizeAndValidateFilePath(pathname)) {
        throw new Error(`Invalid pathname: ${pathname}`)
      }

      const { content, hash } = file.data

      if (content !== undefined) {
        // Updated text file: return file content directly
        srcs.push([content, pathname])

      } else if (hash) {
        // Binary file ("file") or unchanged text file (thoght it's "doc", add to atts anyway)
        // Git-bridge downloads it directly from v1-history using a temporary JWT.
        const token = await JsonWebToken.promises.sign(
          { project_id: projectId },
          { expiresIn: '10m' }
        )
        const downloadUrl = `${V1_HISTORY}/projects/${projectId}/blobs/${hash}?token=${token}`

        atts.push([downloadUrl, pathname])

      } else {
        throw new Error('Snapshot: both content and hash missing: ', pathname)
      }
    }

    res.json({ srcs, atts })

  } catch (err) {

    logger.error({ err, projectId, versionString }, 'Error in getSnapshot')
    return res.sendStatus(400)
  }
}

/*
  Entry point (POST): /api/v0/docs/:project_id/snapshots
  Called by git-bridge after a push.

  body:
    {
      latestVerId: number,
      files: [
        { name: string, url: string | null }
      ],
      postbackUrl: string
    }

  latestVerId:
    Version that is expected to be updated
  files:
    Array describing the complete file set of the new project version
  files.name:
    File path in the project
  files.url:
    If not null, the file is new or modified and must be downloaded from
    git-bridge using this URL, if null, the file is unchanged
  postbackUrl:
    URL where the update result must be posted

  returns:
    { code: 'accepted' } or { code: 'outOfDate' }
    Any other response is treated by git-bridge as an error.
*/

async function postSnapshot(req, res) {

  const projectId = req.params.project_id
  const { latestVerId, files, postbackUrl } = req.body
	
  if (!postbackUrl) {
    logger.error({ projectId }, 'postSnapshot: empty postbackUrl')
    return res.sendStatus(400)
  }

  const userId = req.user_id || null // from auth middleware

  try {
    const project = await ProjectGetter.promises.getProject(projectId, { _id: 1 })
    if (!project) {
      logger.error({ projectId }, 'Project not found')
      return res.sendStatus(404)
    }

    const { version: olLatestVerId } = await fetchJson(`${PROJECT_HISTORY}/project/${projectId}/version`)

    if (latestVerId !== olLatestVerId) {
      // version in Overleaf is changed since last pull, git user needs to pull again
      return res.status(409).json({ code: 'outOfDate' })
    }

    // When "accepted" is returned, git-bridge does not finish the push yet.
    // Instead it waits for the postback callback (performed in pushUpdate)
    // So it should be returned when the server has accepted the request but has not finished processing yet.
    res.status(200).json({ code: 'accepted' })

    GitBridgeHandler.pushUpdate(projectId, files, postbackUrl, userId)
      .catch(err => logger.error({ err, projectId }, 'Error pushing update'))

  } catch (err) {
    logger.error({ err, projectId }, 'Error posting snapshot')
    res.sendStatus(500)
  }
}

export default {
  getDoc: expressify(getDoc),
  getSavedVers: expressify(getSavedVers),
  getSnapshot: expressify(getSnapshot),
  postSnapshot: expressify(postSnapshot),
}
