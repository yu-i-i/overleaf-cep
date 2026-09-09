import { GitHubSyncProjectStates } from '../models/githubSyncProjectStates.mjs'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
const { normalizeQuery } = Mongo

function getProjectState(projectId, projection = {}) {
  return GitHubSyncProjectStates.findOne(normalizeQuery({ projectId }), projection).lean()
}

function createProjectState(projectId, data) {
  // GS-12: upsert instead of create() so re-linking an already-linked project
  // (duplicate unique projectId) updates instead of throwing E11000.
  const doc = { projectId: normalizeQuery(projectId), ...data }
  return GitHubSyncProjectStates.updateOne(
    { projectId: normalizeQuery(projectId) },
    { $set: doc },
    { upsert: true }
  ).then(() => GitHubSyncProjectStates.findOne(normalizeQuery({ projectId }), {}).lean())
}

// GS-16: remove every project state created by a user (used on user deletion)
function removeProjectStatesByOwnerId(ownerId) {
  return GitHubSyncProjectStates.deleteMany({ ownerId: normalizeQuery(ownerId) })
}

function updateProjectState(projectId, data) {
  return GitHubSyncProjectStates.updateOne(
    normalizeQuery({ projectId }),
    { $set: data },
  )
}

function removeProjectState(projectId) {
  return GitHubSyncProjectStates.deleteMany(normalizeQuery({ projectId }))
}

export default {
  getProjectState,
  createProjectState,
  updateProjectState,
  removeProjectState,
  removeProjectStatesByOwnerId,
}
