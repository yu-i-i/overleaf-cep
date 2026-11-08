import { createGitMerge } from '../../../common/app/src/GitMerge.mjs'
import api from './GitHubApiClient.mjs'

export const doGitMerge = createGitMerge(api, 'github')
