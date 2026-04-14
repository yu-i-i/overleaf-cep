/**
 * Factory that returns the correct provider instance for a given provider type.
 *
 * Supported types: 'github', 'gitlab', 'gitea', 'forgejo'
 */

import { GitHubProvider } from './GitHubProvider.mjs'
import { GitLabProvider } from './GitLabProvider.mjs'
import { GiteaProvider } from './GiteaProvider.mjs'

/**
 * @param {'github'|'gitlab'|'gitea'|'forgejo'} providerType
 */
export function createProvider(providerType) {
    switch (providerType) {
        case 'github': return new GitHubProvider()
        case 'gitlab': return new GitLabProvider()
        case 'gitea': return new GiteaProvider('gitea')
        case 'forgejo': return new GiteaProvider('forgejo')
        default:
            throw new Error(`git-integrate: unknown provider type '${providerType}'`)
    }
}

export const SUPPORTED_PROVIDERS = ['github', 'gitlab', 'gitea', 'forgejo']

export const PROVIDER_LABELS = {
    github: 'GitHub',
    gitlab: 'GitLab',
    gitea: 'Gitea',
    forgejo: 'Forgejo',
}

/** Default API base URLs shown in the UI for non-github providers */
export const PROVIDER_DEFAULT_URLS = {
    github: null,   // fixed — users cannot override github.com
    gitlab: 'https://gitlab.com/api/v4',
    gitea: 'https://gitea.com/api/v1',
    forgejo: 'https://codeberg.org/api/v1',
}
