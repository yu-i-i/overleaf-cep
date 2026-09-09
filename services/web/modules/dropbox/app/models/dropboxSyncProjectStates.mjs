import Mongoose from '@overleaf/mongoose-wrapper'

const Schema = Mongoose.Schema

const dropboxSyncSchema = new Schema(
  {
    projectId: { type: Schema.Types.Mixed, required: true },
    // Dropbox connection state
    connected: { type: Boolean, default: false },
    path: { type: String, required: true },
    remoteFiles: {
      type: [
        new Schema(
          {
            path: { type: String, required: true },
            rev: { type: String },
            size: { type: Number },
            modifiedAt: { type: Date },
            // C1: sha256 of the content that last entered the project for
            // this file (set on push-apply and pull-apply); the "local
            // edited?" gate compares current local content against it.
            localHash: { type: String },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Revision tracking for conflict detection (Dropbox uses 'rev' property)
    lastSyncRev: { type: String }, // Last synced revision (from Dropbox's rev property)
    lastSyncVersion: { type: Number }, // Overleaf project version number
    mergeStatus: {
      type: String,
      enum: ['clean', 'diverged', 'conflict'],
      default: 'clean',
    },
    // Owning user (whoever linked the project); scopes unlink/user-expire cleanups
    ownerId: { type: Schema.Types.Mixed, ref: 'User' },
    // U3: project display info stored at link time (read path stays cheap).
    projectName: { type: String },
    projectPath: { type: String }, // full per-project Dropbox path (<root>/<project>)
    // C1: pull-side conflict list (both sides changed; remote NOT applied).
    conflicts: {
      type: [
        new Schema(
          {
            path: { type: String, required: true },
            remoteRev: { type: String },
            localHash: { type: String },
            remoteHash: { type: String },
            at: { type: Date },
          },
          { _id: false }
        ),
      ],
    },
    // Sync tracking (optional)
    lastSyncAt: { type: Date }, // Last successful sync time
    lastSyncError: { type: String }, // Error message from last sync attempt
    lastConflict: {
      path: { type: String }, // Path of conflicting file
      localVersion: { type: String },
      localHash: { type: String }, // C1: sha256 of the local content at conflict time
      remoteRev: { type: String }, // Dropbox uses 'rev' instead of version
      timestamp: { type: Date },
    },
  },
  { timestamps: true }
)

dropboxSyncSchema.index({ projectId: 1 }, { unique: true })
dropboxSyncSchema.index({ ownerId: 1 })
// H.2: scopes the path-keyed disconnect/delete queries ({path, ownerId})
dropboxSyncSchema.index({ path: 1, ownerId: 1 })

export const DropboxSyncProjectStates =
  Mongoose.model('DropboxSyncProjectState', dropboxSyncSchema)
