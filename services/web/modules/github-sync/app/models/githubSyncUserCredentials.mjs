import mongoose from "../../../../app/src/infrastructure/Mongoose.mjs"

const { Schema } = mongoose
const { ObjectId } = Schema

// Provider type for git servers (runtime-compatible)
export const GitProviderType = ['github', 'gitlab', 'gitea', 'forgejo']

/**
 * User credentials for git sync
 * Stores encrypted PAT tokens for multiple servers per provider
 */
export const GitHubSyncUserCredentialsSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    // GS-09: legacy single OAuth token (pre-PAT schema; github.com only).
    // Kept so pre-migration documents remain readable by the legacy fallbacks.
    github: { type: Schema.Types.Mixed },
    // Map of provider -> serverUrl -> encrypted token
    tokens: {
      github: { type: Schema.Types.Mixed },
      gitlab: { type: Schema.Types.Mixed },
      gitea: { type: Schema.Types.Mixed },
      forgejo: { type: Schema.Types.Mixed },
      _id: false
    },
    // Map of provider -> serverUrl -> config (username, timestamps)
    servers: {
      github: { type: Schema.Types.Mixed },
      gitlab: { type: Schema.Types.Mixed },
      gitea: { type: Schema.Types.Mixed },
      forgejo: { type: Schema.Types.Mixed },
      _id: false
    },
    lastUsedAt: { type: Date, default: Date.now }
  },
  { collection: 'githubSyncUserCredentials', minimize: false }
)

export const GitHubSyncUserCredentials = mongoose.model(
  'GitHubSyncUserCredentials',
  GitHubSyncUserCredentialsSchema
)
