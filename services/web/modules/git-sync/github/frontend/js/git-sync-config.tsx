import GithubLogo from '@/shared/svgs/github-logo'
import type { GitSyncConfig } from '../../../common/frontend/js/git-sync-provider'

const repoUrl = (fullName: string) => `https://github.com/${fullName}`

export const githubGitSyncConfig: GitSyncConfig = {
  provider: 'github',
  providerName: 'GitHub',
  basePath: 'github-sync',
  Logo: GithubLogo,
  helpUrl: 'https://help.github.com/en/articles/requesting-organization-approval-for-oauth-apps',
  repoUrl,
  branchUrl: (fullName, branch) => `${repoUrl(fullName)}/tree/${encodeURIComponent(branch)}`,
  commitUrl: (fullName, sha) => `${repoUrl(fullName)}/commit/${sha}`,
}
