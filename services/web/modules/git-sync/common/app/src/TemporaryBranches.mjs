import logger from '@overleaf/logger'
import { generateBranchName } from './GitMergeHelpers.mjs'
import { GitConflictError, ProviderRequestError } from './GitSyncErrors.mjs'

let lastName
let counter = 0

export function createTemporaryBranches(api) {
  async function createBranch(token, repoFullName, commit, suffix = '') {
    const timestamp = generateBranchName()
    counter = timestamp === lastName ? counter + 1 : 0
    lastName = timestamp
    const name = timestamp + (counter ? `-${counter}` : '') + suffix
    await api.createBranch(token, repoFullName, name, commit)
    return name
  }

  async function deleteBranchBestEffort(token, repoFullName, branch, expectedCommit) {
    try {
      if (!expectedCommit) {
        logger.warn({ repoFullName, branch }, 'Preserving a Git sync branch with an unknown cleanup baseline')
        return
      }
      if (await api.getBranchHead(token, repoFullName, branch) !== expectedCommit) {
        logger.warn({ repoFullName, branch }, 'Preserving a Git sync branch that changed before cleanup')
        return
      }
      await api.deleteBranch(token, repoFullName, branch)
    } catch (err) {
      logger.warn({ err, repoFullName, branch }, 'Failed to clean up Git sync branch')
    }
  }

  async function mergeWithTempBranch(token, repoFullName, branchName, updateCommit) {
    const tempBranchName = await createBranch(token, repoFullName, updateCommit)
    try {
      const mergeCommit = await api.mergeBranch(token, repoFullName, branchName, tempBranchName, updateCommit)
      if (!mergeCommit || !await api.isAncestor(token, repoFullName, updateCommit, mergeCommit)) {
        throw new ProviderRequestError('The merge omitted the expected source commit.', { status: 409 })
      }
      await deleteBranchBestEffort(token, repoFullName, tempBranchName, updateCommit)
      return { conflict: false, mergeCommit }
    } catch (err) {
      if (err instanceof GitConflictError) {
        if (await api.getBranchHead(token, repoFullName, tempBranchName) !== updateCommit) {
          throw new ProviderRequestError('The source branch changed before recording the conflict.', { status: 409 })
        }
        return { conflict: true, tempBranchName }
      }
      throw err
    }
  }

  return { mergeWithTempBranch, createBranch, deleteBranchBestEffort }
}
