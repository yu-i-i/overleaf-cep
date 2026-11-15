import { createGitMerge } from '../../../common/app/src/GitMerge.mjs'
import api from './GiteaApiClient.mjs'

export const doGitMerge = createGitMerge(api, 'gitea')
