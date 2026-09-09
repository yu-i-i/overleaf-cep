import Settings from '@overleaf/settings'
import Modules from '../../app/src/infrastructure/Modules.mjs'
import logger from '@overleaf/logger'

let DropboxModule = {}
if (process.env.DROPBOX_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling Dropbox module')

  const [
    { default: DropboxRouter, normalizeDropboxPath },
    { DropboxSyncProjectStates },
    { DropboxUserCredentials },
  ] = await Promise.all([
    import('./app/src/DropboxRouter.mjs'),
    import('./app/models/dropboxSyncProjectStates.mjs'),
    import('./app/models/dropboxUserCredentials.mjs'),
  ])

  // Set Settings.dropbox for frontend exposure
  Settings.dropbox = {
    enabled: true,
    apiUrl: process.env.DROPBOXINTERFACE_API_URL || 'http://localhost:4003',
  }

  logger.debug({}, 'Dropbox settings:', JSON.stringify(Settings.dropbox))

  // Delete project sync state from mongo (hook 'projectExpired')
  Modules.hooks.attach('projectExpired', async projectId => {
    try {
      await DropboxSyncProjectStates.deleteMany({ projectId })
      logger.debug({ projectId }, 'on project expire: removed Dropbox sync state')
    } catch (err) {
      logger.warn(
        { projectId, err },
        'on project expire: failed to remove Dropbox sync state'
      )
    }
  })

  // Delete user credentials from mongo (hook 'expireDeletedUser')
  // Order matters: collect credentials FIRST, delete the project states they
  // own, and only then delete the credentials (DBX-05: deleting first left the
  // "unlink all projects" loop with an empty credential list and orphaned state).
  Modules.hooks.attach('expireDeletedUser', async userId => {
    try {
      const credentialsList = await DropboxUserCredentials.find({ userId }).lean()

      // Unlink all projects associated with this user's Dropbox accounts
      for (const cred of credentialsList) {
        if (cred.path) {
          const path = normalizeDropboxPath(cred.path)
          await DropboxSyncProjectStates.deleteMany({ $or: [{ path }, { ownerId: userId }] })
          logger.debug(
            { userId, path },
            'on user expire: unlinked all projects with this Dropbox path'
          )
        }
      }
      // Catch any legacy state docs only keyed by owner
      await DropboxSyncProjectStates.deleteMany({ ownerId: userId })

      // Finally delete the credentials
      await DropboxUserCredentials.deleteMany({ userId })
    } catch (err) {
      logger.warn({ userId, err }, 'on user expire: failed removing user credentials')
    }
  })

  DropboxModule = {
    router: DropboxRouter,
  }
}

logger.info({}, 'Dropbox module ready:', DropboxModule ? 'router exists' : 'disabled')
export default DropboxModule
