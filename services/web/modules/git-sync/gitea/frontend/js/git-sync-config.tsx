import GiteaLogo from './svg/gitea-logo'
import ForgejoLogo from './svg/forgejo-logo'
import getMeta from '@/utils/meta'
import type { GitSyncConfig } from '../../../common/frontend/js/git-sync-provider'

const settings = getMeta('ol-ExposedSettings') as { giteaUrl?: string; giteaBrand?: string; giteaTitle?: string }
const forgejo = settings.giteaBrand === 'forgejo'
const repoUrl = (fullName: string) => `${settings.giteaUrl || ''}/${fullName}`

export const giteaGitSyncConfig: GitSyncConfig = {
  provider: 'gitea',
  providerName: forgejo ? 'Forgejo' : 'Gitea',
  displayTitle: settings.giteaTitle?.trim() || (forgejo ? 'Forgejo' : 'Gitea'),
  basePath: 'gitea-sync',
  Logo: forgejo ? ForgejoLogo : GiteaLogo,
  repoUrl,
  branchUrl: (fullName, branch) => `${repoUrl(fullName)}/src/branch/${branch.split('/').map(encodeURIComponent).join('/')}`,
  commitUrl: (fullName, sha) => `${repoUrl(fullName)}/commit/${sha}`,
}
