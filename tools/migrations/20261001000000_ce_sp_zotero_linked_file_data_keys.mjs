import { batchedUpdate } from '@overleaf/mongo-utils/batchedUpdate.js'
import { promiseMapWithLimit } from '@overleaf/promise-utils'
import { db } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

const WRITE_CONCURRENCY = parseInt(process.env.WRITE_CONCURRENCY, 10) || 10

// The Zotero module used to store linkedFileData with its own key names.
// "Zotero: fix for 6.3.0" switched to the names accepted by the
// overleaf-editor-core schema, but files imported before that still carry the
// old keys, which document-updater rejects (e.g. when cloning the project).
const LEGACY_KEYS = [
  'zoteroGroupId',
  'importedByUserId',
  'importedByName',
  'bibFormat',
]

function hasLegacyKeys(data) {
  return (
    data?.provider === 'zotero' && LEGACY_KEYS.some(key => key in data)
  )
}

function convert(data) {
  const importerId = data.importer_id ?? data.importedByUserId
  const format = data.format ?? data.bibFormat
  return {
    provider: 'zotero',
    group_id: data.group_id ?? data.zoteroGroupId ?? null,
    ...(data.importedAt && { importedAt: data.importedAt }),
    ...(importerId && { importer_id: importerId.toString() }),
    importer_name: data.importer_name ?? data.importedByName ?? 'Unknown',
    format: format === 'biblatex' ? 'biblatex' : 'bibtex',
  }
}

function collectUpdates(folder, mongoPath, updates) {
  if (!folder) return
  ;(folder.fileRefs || []).forEach((file, i) => {
    if (hasLegacyKeys(file?.linkedFileData)) {
      updates[`${mongoPath}.fileRefs.${i}.linkedFileData`] = convert(
        file.linkedFileData
      )
    }
  })
  ;(folder.folders || []).forEach((subfolder, i) => {
    collectUpdates(subfolder, `${mongoPath}.folders.${i}`, updates)
  })
}

const migrate = async () => {
  await batchedUpdate(
    db.projects,
    {},
    async nextBatch => {
      await promiseMapWithLimit(WRITE_CONCURRENCY, nextBatch, async project => {
        const updates = {}
        ;(project.rootFolder || []).forEach((folder, i) => {
          collectUpdates(folder, `rootFolder.${i}`, updates)
        })
        if (Object.keys(updates).length === 0) return
        await db.projects.updateOne({ _id: project._id }, { $set: updates })
      })
    },
    { _id: 1, rootFolder: 1 }
  )
}

const rollback = async () => {}

export default {
  tags,
  migrate,
  rollback,
}
