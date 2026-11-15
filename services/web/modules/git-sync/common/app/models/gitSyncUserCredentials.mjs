import mongoose from "../../../../../app/src/infrastructure/Mongoose.mjs"

const { Schema } = mongoose
const { ObjectId } = Schema

export const GitSyncUserCredentialsSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    github: { type: String },
    gitlab: { type: String },
    gitea: { type: String },
  },
  { collection: 'gitSyncUserCredentials', minimize: false }
)

export const GitSyncUserCredentials = mongoose.model(
  'GitSyncUserCredentials',
  GitSyncUserCredentialsSchema,
)
