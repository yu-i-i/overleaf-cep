import GitLabLogo from './svgs/gitlab-logo'
import getMeta from '@/utils/meta'
import type { GitSyncConfig } from '../../../common/frontend/js/git-sync-provider'

const settings = getMeta('ol-ExposedSettings') as { gitlabUrl?: string; gitlabTitle?: string }
const repoUrl = (fullName: string) => `${settings.gitlabUrl || ''}/${fullName}`

export const gitlabGitSyncConfig: GitSyncConfig = {
  provider: 'gitlab',
  providerName: 'GitLab',
  displayTitle: settings.gitlabTitle?.trim() || 'GitLab',
  basePath: 'gitlab-sync',
  Logo: GitLabLogo,
  helpUrl: 'https://docs.gitlab.com/administration/settings/account_and_limit_settings/',
  repoUrl,
  branchUrl: (fullName, branch) => `${repoUrl(fullName)}/-/tree/${encodeURIComponent(branch)}?ref_type=heads`,
  commitUrl: (fullName, sha) => `${repoUrl(fullName)}/-/commit/${sha}`,
}
