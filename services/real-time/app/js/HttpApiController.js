import WebsocketLoadBalancer from './WebsocketLoadBalancer.js'
import DrainManager from './DrainManager.js'
import ConnectedUsersManager from './ConnectedUsersManager.js'
import logger from '@overleaf/logger'

export default {
  countConnectedClients(req, res) {
    const { projectId } = req.params
    ConnectedUsersManager.countConnectedClients(
      projectId,
      (err, nConnectedClients) => {
        if (err) {
          logger.err({ err, projectId }, 'count connected clients failed')
          return res.sendStatus(500)
        }
        res.json({ nConnectedClients })
      }
    )
  },

  // Return all active projects with connected users (used by admin Manage Site)
  getAllActiveProjects(req, res) {
    try {
      const io = req.app.get('io')
      const activeProjects = {}

      // io.sockets.sockets is a Map-like in newer socket.io; normalize to array
      const clients = Array.from(Object.values(io.sockets.sockets || {}))

      logger.info({ totalClients: clients.length }, 'getting all active projects')

      for (const client of clients) {
        const projectId = client.ol_context?.projectId || client.ol_context?.project_id
        const userId = client.ol_context?.userId || client.ol_context?.user_id

        if (!projectId) {
          logger.debug({ clientId: client.id }, 'client has no project_id')
          continue
        }

        if (!activeProjects[projectId]) {
          activeProjects[projectId] = {
            projectId,
            users: {},
            connectionCount: 0,
          }
        }

        activeProjects[projectId].connectionCount++

        if (userId && userId !== 'anonymous-user') {
          if (!activeProjects[projectId].users[userId]) {
            activeProjects[projectId].users[userId] = {
              userId,
              firstName: client.ol_context?.firstName || client.ol_context?.first_name || '',
              lastName: client.ol_context?.lastName || client.ol_context?.last_name || '',
              email: client.ol_context?.email || '',
            }
          }
        }
      }

      const result = Object.values(activeProjects).map(project => ({
        projectId: project.projectId,
        users: Object.values(project.users),
        connectionCount: project.connectionCount,
      }))

      logger.info({ projectCount: result.length }, 'returning active projects')
      res.json({ projects: result })
    } catch (err) {
      logger.err({ err }, 'error getting all active projects')
      res.sendStatus(500)
    }
  },

  sendMessage(req, res) {
    logger.debug({ message: req.params.message }, 'sending message')
    if (Array.isArray(req.body)) {
      for (const payload of req.body) {
        WebsocketLoadBalancer.emitToRoom(
          req.params.project_id,
          req.params.message,
          payload
        )
      }
    } else {
      WebsocketLoadBalancer.emitToRoom(
        req.params.project_id,
        req.params.message,
        req.body
      )
    }
    res.sendStatus(204)
  },

  startDrain(req, res) {
    const io = req.app.get('io')
    let rate = req.query.rate || '4'
    rate = parseFloat(rate) || 0
    logger.info({ rate }, 'setting client drain rate')
    DrainManager.startDrain(io, rate)
    res.sendStatus(204)
  },

  disconnectClient(req, res, next) {
    const io = req.app.get('io')
    const { client_id: clientId } = req.params
    const client = io.sockets.sockets[clientId]

    if (!client) {
      logger.debug({ clientId }, 'api: client already disconnected')
      res.sendStatus(404)
      return
    }
    logger.info({ clientId }, 'api: requesting client disconnect')
    client.on('disconnect', () => res.sendStatus(204))
    client.disconnect()
  },
}
