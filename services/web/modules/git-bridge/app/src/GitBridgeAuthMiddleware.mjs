import logger from '@overleaf/logger'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import GitBridgePATManager from './GitBridgePATManager.mjs'

const permissionChecks = {
  read: AuthorizationManager.promises.canUserReadProject,
  write: AuthorizationManager.promises.canUserWriteProjectContent
}

export default function ensureTokenProjectAccess(permission) {
  const checkPermission = permissionChecks[permission]
  if (!checkPermission) {
    throw new Error(`Invalid permission: ${permission}`)
  }

  return async function (req, res, next) {
    try {
      const projectId = req.params.project_id
      if (!projectId) return res.sendStatus(400)

      const header = req.headers.authorization || ''
      const [scheme, token] = header.trim().split(/\s+/, 2)
      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return res.sendStatus(401)
      }

      const userId = await GitBridgePATManager.getUserId(token)
      if (!userId) return res.sendStatus(401)

      const allowed = await checkPermission(userId, projectId, null)

      if (!allowed) return res.sendStatus(403)

      req.user_id = userId
      return next()
    } catch (err) {
      logger.error({ err }, 'Failed to check personal access token')
      return res.sendStatus(500)
    }
  }
}
