import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import WakaTimeApiClient from './WakaTimeApiClient.mjs'
import TokenManager from './TokenManager.mjs'

const MAX_BULK_HEARTBEATS = 50

function sendError(res, err, operation) {
  const info = OError.getFullInfo(err)
  const status = info?.status || 500
  logger.error(OError.getFullStack(err))
  logger.error({ info, operation }, 'WakaTime request failed')
  res.status(status).json({ message: err.message })
}

/**
 * GET /user/wakatime/status
 */
async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const status = await WakaTimeApiClient.getConnectionStatus(userId)
    res.json(status)
  } catch (err) {
    sendError(res, err, 'getConnectionStatus')
  }
}

/**
 * PUT /user/wakatime
 * body: { apiUrl, apiKey }
 * Verifies the credentials against the target server before storing them.
 */
async function link(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { apiUrl, apiKey } = req.body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ message: 'apiKey is required' })
  }

  try {
    await WakaTimeApiClient.verifyCredentials(apiUrl, apiKey)
    await TokenManager.storeCredentials(userId, apiUrl, apiKey)
    res.sendStatus(200)
  } catch (err) {
    sendError(res, err, 'link')
  }
}

/**
 * DELETE /user/wakatime
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await WakaTimeApiClient.unlinkAccount(userId)
    res.sendStatus(200)
  } catch (err) {
    sendError(res, err, 'unlink')
  }
}

/**
 * POST /project/:project_id/wakatime/heartbeat
 * body: a single WakaTime heartbeat payload (entity, type, time, ...)
 * Forwards the heartbeat to the user's configured WakaTime/Wakapi server,
 * filling in the project name server-side so the client never needs to
 * know (or spoof) it.
 */
async function heartbeat(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params

  try {
    const project = await Project.findById(projectId, 'name').exec()
    if (!project) return res.sendStatus(404)

    await WakaTimeApiClient.sendHeartbeat(userId, {
      ...req.body,
      project: project.name,
    })
    res.sendStatus(202)
  } catch (err) {
    sendError(res, err, 'heartbeat')
  }
}

/**
 * POST /project/:project_id/wakatime/heartbeats/bulk
 * body: an array of WakaTime heartbeat payloads
 */
async function heartbeatsBulk(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params
  const heartbeats = Array.isArray(req.body) ? req.body : []

  if (heartbeats.length === 0) return res.sendStatus(204)
  if (heartbeats.length > MAX_BULK_HEARTBEATS) {
    return res.status(400).json({ message: 'too many heartbeats in one batch' })
  }

  try {
    const project = await Project.findById(projectId, 'name').exec()
    if (!project) return res.sendStatus(404)

    await WakaTimeApiClient.sendHeartbeatsBulk(
      userId,
      heartbeats.map(h => ({ ...h, project: project.name }))
    )
    res.sendStatus(202)
  } catch (err) {
    sendError(res, err, 'heartbeatsBulk')
  }
}

/**
 * GET /project/:project_id/wakatime/summary
 * Returns total tracked time (in seconds) for this project over the last
 * `range` days (query param, default 7).
 */
async function summary(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params
  const range = Math.min(parseInt(req.query.range, 10) || 7, 90)

  try {
    const project = await Project.findById(projectId, 'name').exec()
    if (!project) return res.sendStatus(404)

    const result = await WakaTimeApiClient.getProjectSummary(
      userId,
      project.name,
      range
    )
    if (!result) return res.json({ connected: false })

    res.json({ connected: true, ...result })
  } catch (err) {
    sendError(res, err, 'summary')
  }
}

export default {
  getConnectionStatus,
  link,
  unlink,
  heartbeat,
  heartbeatsBulk,
  summary,
}
