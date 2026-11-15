
import { db, getCollectionNames, getCollectionInternal } from './lib/mongodb.mjs'
import createAccessTokenEncryptor from '../../services/web/modules/git-sync/common/app/src/AccessTokenEncryptorHelper.mjs'

export const tags = ['server-ce']

export async function migrate() {
  const collections = new Set(await getCollectionNames())
  const renames = [
    ['githubSyncProjectStates', 'gitSyncProjectStates'],
    ['githubSyncUserCredentials', 'gitSyncUserCredentials'],
  ]

  for (const [oldName, newName] of renames) {
    if (collections.has(oldName) && collections.has(newName)) {
      throw new Error(`Both ${oldName} and ${newName} exist; resolve this before migrating`)
    }
  }

  if (collections.has('githubSyncProjectStates')) {
    const states = db.githubSyncProjectStates
    const unexpectedProvider = await states.findOne({
      provider: { $exists: true, $nin: ['github', null] },
    })
    if (unexpectedProvider) {
      throw new Error('githubSyncProjectStates contains non-GitHub states')
    }

    await states.updateMany(
      { provider: null },
      { $set: { provider: 'github' } }
    )
    await states.createIndex({ projectId: 1, provider: 1 }, { unique: true })

    for (const index of await states.indexes()) {
      if (
        index.unique &&
        Object.keys(index.key).length === 1 &&
        index.key.projectId === 1
      ) {
        await states.dropIndex(index.name)
      }
    }
    await states.rename('gitSyncProjectStates')
  }

  if (collections.has('githubSyncUserCredentials')) {
    await db.githubSyncUserCredentials.rename('gitSyncUserCredentials')
  }

  const credentials = await getCollectionInternal('gitSyncUserCredentials')
  const encryptor = createAccessTokenEncryptor('github')
  const cursor = credentials.find(
    { github: { $type: 'string' } },
    { projection: { _id: 1, github: 1 } }
  )

  try {
    for await (const record of cursor) {
      let stored
      try {
        stored = await encryptor.decryptToJson(record.github)
      } catch {
        throw new Error(`Cannot decrypt GitHub credentials for record ${record._id}`)
      }

      if (
        stored &&
        typeof stored === 'object' &&
        typeof stored.token === 'string' &&
        stored.token.length > 0
      ) {
        continue
      }

      if (typeof stored !== 'string' || stored.length === 0) {
        throw new Error(`Invalid GitHub credentials for record ${record._id}`)
      }

      let encrypted
      try {
        encrypted = await encryptor.encryptJson({ token: stored })
      } catch {
        throw new Error(`Cannot encrypt GitHub credentials for record ${record._id}`)
      }

      const result = await credentials.updateOne(
        { _id: record._id, github: record.github },
        { $set: { github: encrypted } }
      )
      if (result.modifiedCount !== 1) {
        throw new Error(`GitHub credentials changed during migration for record ${record._id}`)
      }
    }
  } finally {
    await cursor.close()
  }
}
