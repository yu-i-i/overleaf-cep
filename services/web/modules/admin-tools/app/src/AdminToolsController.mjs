import { expressify } from '@overleaf/promise-utils'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import request from 'request'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

// Helper function to get all active projects from real-time service
async function getActiveProjectsFromRealTime() {
  return new Promise((resolve, reject) => {
    const realTimeUrl = Settings.apis.realTime?.url || 'http://127.0.0.1:3026'
    const url = `${realTimeUrl}/clients`
    const user = Settings.apis.realTime?.user || process.env.WEB_API_USER || 'overleaf'
    const pass = Settings.apis.realTime?.pass || process.env.WEB_API_PASSWORD || ''

    logger.info({ url, user }, 'Fetching active clients from real-time service')

    request.get({
      url,
      auth: { user, pass, sendImmediately: true },
      json: true,
      timeout: 10000
    }, async (error, response, body) => {
      if (error) {
        logger.error({ err: error }, 'Error getting active clients from real-time')
        return resolve([])
      }
      if (response.statusCode !== 200) {
        logger.warn({ statusCode: response.statusCode }, 'Unexpected response from real-time service')
        return resolve([])
      }
      if (!Array.isArray(body)) {
        logger.warn({ body }, 'Unexpected response body from real-time service')
        return resolve([])
      }

      // Group flat client list by project_id
      const projectMap = new Map()
      for (const client of body) {
        if (!projectMap.has(client.project_id)) {
          projectMap.set(client.project_id, [])
        }
        projectMap.get(client.project_id).push(client)
      }

      logger.info({ projectCount: projectMap.size }, 'Got active projects from real-time')

      try {
        const enrichedProjects = await Promise.all(
          [...projectMap.entries()].map(async ([projectId, clients]) => {
            try {
              const project = await ProjectGetter.promises.getProject(projectId, {
                name: 1,
                _id: 1,
                owner_ref: 1,
              })
              if (!project) {
                logger.warn({ projectId }, 'Project not found in database')
                return null
              }
              const owner = await UserGetter.promises.getUser(project.owner_ref, {
                email: 1,
                first_name: 1,
                last_name: 1,
              })
              return {
                id: project._id.toString(),
                name: project.name,
                owner: owner ? {
                  email: owner.email,
                  name: `${owner.first_name || ''} ${owner.last_name || ''}`.trim() || owner.email,
                } : null,
                activeUsers: clients.map(c => ({
                  name: `${c.first_name} ${c.last_name}`.trim() || c.email || 'Unknown',
                  email: c.email,
                })),
                connectionCount: clients.length,
              }
            } catch (err) {
              logger.error({ err, projectId }, 'Error enriching project data')
              return null
            }
          })
        )
        resolve(enrichedProjects.filter(p => p !== null))
      } catch (err) {
        logger.error({ err }, 'Error processing active projects')
        resolve([])
      }
    })
  })
}

async function activeProjects(req, res) {
  const activeProjects = await getActiveProjectsFromRealTime()
  res.json(activeProjects)
}

export default {
  activeProjects: expressify(activeProjects),
}
