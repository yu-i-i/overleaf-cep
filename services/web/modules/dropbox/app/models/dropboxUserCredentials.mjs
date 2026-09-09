import Mongoose from '@overleaf/mongoose-wrapper'

const Schema = Mongoose.Schema

export const DropboxUserCredentialsSchema = new Schema(
  {
    userId: { type: Schema.Types.Mixed, ref: 'User', required: true, unique: true },
    // Encrypted credentials - contains access_token
    accessToken: { type: String, required: true },
    // Encrypted refresh_token (Dropbox rotates it on every refresh; kept so
    // connections don't die hours after authorizing when the access token
    // expires)
    refreshToken: { type: String },
    path: { type: String, default: '/' },
  },
  { minimize: false }
)

export const DropboxUserCredentials = Mongoose.model(
  'DropboxUserCredentials',
  DropboxUserCredentialsSchema,
)
