import { createGitMerge } from '../../../common/app/src/GitMerge.mjs'
import api from './GitLabApiClient.mjs'

export const doGitMerge = createGitMerge(api, 'gitlab')
