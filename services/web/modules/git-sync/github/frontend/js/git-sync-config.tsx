import GithubLogo from '@/shared/svgs/github-logo'
import getMeta from '@/utils/meta'
import type { GitSyncConfig } from '../../../common/frontend/js/git-sync-provider'

const { githubUrl, githubTitle } = getMeta('ol-ExposedSettings') as {
  githubUrl: string
  githubTitle: string
}
const repoUrl = (fullName: string) => `${githubUrl}/${fullName}`

export const githubGitSyncConfig: GitSyncConfig = {
  provider: 'github',
  providerName: 'GitHub',
  displayTitle: githubTitle,
  basePath: 'github-sync',
  Logo: GithubLogo,
  repoUrl,
  branchUrl: (fullName, branch) => `${repoUrl(fullName)}/tree/${encodeURIComponent(branch)}`,
  commitUrl: (fullName, sha) => `${repoUrl(fullName)}/commit/${sha}`,
}
