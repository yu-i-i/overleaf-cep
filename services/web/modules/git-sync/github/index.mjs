import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

let GitHubSyncModule = {}

if (process.env.GITHUB_SYNC_ENABLED?.toLowerCase() === 'true') {
  logger.debug({}, 'Enabling GitHub Sync module')

  const siteUrl = Settings.siteUrl?.replace(/\/+$/, '') || 'http://localhost'
  Settings.githubSync = {
    clientID: process.env.GITHUB_SYNC_CLIENT_ID,
    clientSecret: process.env.GITHUB_SYNC_CLIENT_SECRET,
    callbackURL: `${siteUrl}/user/github-sync/oauth2/callback`,
  }

  const [
    { default: api },
    { GitSyncProjectStates },
    { default: createGitSyncModule },
    { doGitMerge },
  ] = await Promise.all([
    import('./app/src/GitHubApiClient.mjs'),
    import('../common/app/models/gitSyncProjectStates.mjs'),
    import('../common/app/src/createGitSyncModule.mjs'),
    import('./app/src/GitMerge.mjs'),
  ])

  GitHubSyncModule = await createGitSyncModule({
    provider: 'github',
    api,
    ProjectStates: GitSyncProjectStates,
    doGitMerge,
  })
}

export default GitHubSyncModule
