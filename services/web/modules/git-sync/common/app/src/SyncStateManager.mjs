import { GitNotLinkedError } from './GitSyncErrors.mjs'
import Mongo from '../../../../../app/src/Features/Helpers/Mongo.mjs'
const { normalizeQuery } = Mongo

export default function createSyncStateManager(model, provider) {
  function projectQuery(projectId) {
    return {
      ...normalizeQuery({ projectId }),
      provider,
    }
  }

  function getProjectState(projectId, projection = {}) {
    return model.findOne(projectQuery(projectId), projection).lean()
  }

  function createProjectState(projectId, data) {
    return model.create({
      projectId: normalizeQuery(projectId),
      ...data,
      provider,
    })
  }

  async function updateProjectState(projectId, data, expectedState = {}) {
    const result = await model.updateOne(
      { ...projectQuery(projectId), ...expectedState },
      { $set: data },
    )
    // Conditional overview updates may legitimately lose a race. Mandatory
    // journal and state writes must still match the linked project.
    if (Object.keys(expectedState).length === 0 && result?.matchedCount !== 1) {
      throw new GitNotLinkedError(projectId)
    }
    return result
  }

  function finishSync(projectId, lastSyncCommit, lastSyncVersion) {
    return updateProjectState(projectId, {
      mergeStatus: 'clean', lastSyncCommit, lastSyncVersion,
      pendingPull: null, conflictVersion: null,
      unmergedBranchName: null, unmergedBranchHead: null,
    })
  }

  function removeProjectState(projectId) {
    return model.deleteMany(projectQuery(projectId))
  }

  return {
    getProjectState,
    createProjectState,
    updateProjectState,
    finishSync,
    removeProjectState,
  }
}
