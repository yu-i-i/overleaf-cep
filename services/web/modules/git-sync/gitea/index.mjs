import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

let GiteaSyncModule = {}

if (process.env.GITEA_SYNC_ENABLED?.toLowerCase() === 'true') {
  if (!process.env.GITEA_SYNC_URL || !process.env.GITEA_SYNC_CLIENT_ID || !process.env.GITEA_SYNC_CLIENT_SECRET) {
    logger.warn({}, 'Gitea Sync enabled without mandatory environment variables')
  } else {
    logger.debug({}, 'Enabling Gitea Sync module')

    const siteUrl = Settings.siteUrl?.replace(/\/+$/, '') || 'http://localhost'
    const brand = process.env.GITEA_SYNC_BRANDING?.trim().toLowerCase() || 'gitea'
    if (brand !== 'gitea' && brand !== 'forgejo') {
      throw new Error('GITEA_SYNC_BRANDING must be gitea or forgejo')
    }
    Settings.giteaSync = {
      brand,
      title: process.env.GITEA_SYNC_TITLE?.trim() || (brand === 'forgejo' ? 'Forgejo' : 'Gitea'),
      url: process.env.GITEA_SYNC_URL.replace(/\/+$/, ''),
      clientID: process.env.GITEA_SYNC_CLIENT_ID,
      clientSecret: process.env.GITEA_SYNC_CLIENT_SECRET,
      callbackURL: `${siteUrl}/user/gitea-sync/oauth2/callback`,
    }

    const [
      { default: api },
      { GitSyncProjectStates },
      { default: createGitSyncModule },
      { doGitMerge },
    ] = await Promise.all([
      import('./app/src/GiteaApiClient.mjs'),
      import('../common/app/models/gitSyncProjectStates.mjs'),
      import('../common/app/src/createGitSyncModule.mjs'),
      import('./app/src/GitMerge.mjs'),
    ])

    GiteaSyncModule = await createGitSyncModule({
      provider: 'gitea',
      api,
      ProjectStates: GitSyncProjectStates,
      doGitMerge,
    })
  }
}

export default GiteaSyncModule
