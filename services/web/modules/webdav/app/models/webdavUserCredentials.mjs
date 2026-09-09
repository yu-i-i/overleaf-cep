import Mongoose from '@overleaf/mongoose-wrapper'

const Schema = Mongoose.Schema

export const WebdavUserCredentialsSchema = new Schema(
  {
    userId: { type: Schema.Types.Mixed, ref: 'User', required: true, unique: true },
    // Encrypted credentials - contains baseUrl, rootPath, username, password/token
    credentials: { type: String, required: true },
  },
  { minimize: false }
)

export const WebdavUserCredentials = Mongoose.model(
  'WebdavUserCredentials',
  WebdavUserCredentialsSchema,
)
