import mongoose from "../../../../app/src/infrastructure/Mongoose.mjs"

const { Schema } = mongoose
const { ObjectId } = Schema

export const GitHubSyncProjectStatesSchema = new Schema(
  {
    projectId: { type: ObjectId, ref: 'Project', required: true, unique: true },
    repoFullName: { type: String, required: true },
    defaultBranchName: { type: String, default: null },
    mergeStatus: { type: String, enum: ['clean', 'conflict', 'diverged'], default: 'clean' },
    // GS-16: who created this link — allows expireDeletedUser cleanup
    ownerId: { type: ObjectId, ref: 'User', default: null },
    lastSyncCommit: { type: String, default: null },
    lastSyncVersion: { type: Number, default: null },
    unmergedBranchName: { type: String, default: null },
    unmergedBranchHead: { type: String, default: null },
    conflictVersion: { type: Number, default: null },
    // GS-18: which provider/server/username owns this link. Without these the
    // schema silently DROPS them from every upsert (mongoose strict mode), so
    // getMergeOverview/merge fell back to the default GitHub server and every
    // GitLab/Gitea/Forgejo link 404'd ("repository not found" on github.com).
    syncProvider: { type: String, default: 'github' },
    syncServerUrl: { type: String, default: null },
    syncUsername: { type: String, default: null },
  },
  { collection: 'githubSyncProjectStates', minimize: false }
)

export const GitHubSyncProjectStates = mongoose.model(
  'GitHubSyncProjectStates',
  GitHubSyncProjectStatesSchema,
)
