import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema

export const GitSyncProjectStatesSchema = new Schema(
  {
    projectId: { type: ObjectId, ref: 'Project', required: true },
    provider: { type: String, enum: ['github', 'gitlab', 'gitea'], required: true },
    repoFullName: { type: String, required: true },
    defaultBranchName: { type: String, default: null },
    mergeStatus: { type: String, enum: ['clean', 'conflict', 'diverged', 'publishing'], default: 'clean' },
    lastSyncCommit: { type: String, default: null },
    lastSyncVersion: { type: Number, default: null },
    unmergedBranchName: { type: String, default: null },
    unmergedBranchHead: { type: String, default: null },
    pendingPull: {
      type: new Schema({
        commit: { type: String, required: true },
        cursorVersion: { type: Number, required: true },
        complete: { type: Boolean, default: false },
      }, { _id: false }),
      default: null,
    },
    conflictVersion: { type: Number, default: null },
  },
  { collection: 'gitSyncProjectStates', minimize: false }
)
GitSyncProjectStatesSchema.index({ projectId: 1, provider: 1 }, { unique: true })

export const GitSyncProjectStates = mongoose.model('GitSyncProjectStates', GitSyncProjectStatesSchema)

