import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

let GitLabSyncModule = {}

if (process.env.GITLAB_SYNC_ENABLED?.toLowerCase() === 'true') {
  if (!process.env.GITLAB_SYNC_URL || !process.env.GITLAB_SYNC_CLIENT_ID || !process.env.GITLAB_SYNC_CLIENT_SECRET) {
    logger.warn({}, 'GitLab Sync enabled without mandatory environment variables')
  } else {
    logger.debug({}, 'Enabling GitLab Sync module')

    const siteUrl = Settings.siteUrl?.replace(/\/+$/, '') || 'http://localhost'
    Settings.gitlabSync = {
      url: process.env.GITLAB_SYNC_URL.replace(/\/+$/, ''),
      title: process.env.GITLAB_SYNC_TITLE?.trim() || 'GitLab',
      clientID: process.env.GITLAB_SYNC_CLIENT_ID,
      clientSecret: process.env.GITLAB_SYNC_CLIENT_SECRET,
      callbackURL: `${siteUrl}/user/gitlab-sync/oauth2/callback`,
      mergeRequestPollInterval: process.env.GITLAB_MERGE_REQUEST_POLL_INTERVAL_MS || 1000,
      mergeRequestTimeout: process.env.GITLAB_MERGE_REQUEST_TIMEOUT_MS || 60_000,
    }

    const [
      { default: api },
      { GitSyncProjectStates },
      { default: createGitSyncModule },
      { doGitMerge },
    ] = await Promise.all([
      import('./app/src/GitLabApiClient.mjs'),
      import('../common/app/models/gitSyncProjectStates.mjs'),
      import('../common/app/src/createGitSyncModule.mjs'),
      import('./app/src/GitMerge.mjs'),
    ])

    GitLabSyncModule = await createGitSyncModule({
      provider: 'gitlab',
      api,
      ProjectStates: GitSyncProjectStates,
      doGitMerge,
    })
  }
}

export default GitLabSyncModule
