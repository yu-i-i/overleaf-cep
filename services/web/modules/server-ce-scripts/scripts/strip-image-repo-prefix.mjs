import minimist from 'minimist'
import { db } from '../../../app/src/infrastructure/mongodb.mjs'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)

function stripRepoPrefix(name) {
  if (typeof name !== 'string') return ''
  const parts = name.split('/')
  return parts[parts.length - 1]
}

export default async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['dry-run'],
    default: { 'dry-run': true },
  })

  const dryRun = argv['dry-run']
  const collections = ['projects', 'templates']

  for (const collectionName of collections) {
    const collection = db[collectionName]

    console.log(`\nProcessing collection: ${collectionName}`)

    const rows = []
    const cursor = collection.find({ imageName: { $regex: '/' } })

    for await (const doc of cursor) {
      const oldName = doc.imageName
      if (typeof oldName !== 'string') continue

      const newName = stripRepoPrefix(oldName)
      if (oldName === newName) continue

      rows.push({
        id: String(doc._id),
        old: oldName,
        new: newName,
        doc,
      })
    }

    const idWidth = Math.max(...rows.map(r => r.id.length), 2)
    const oldWidth = Math.max(...rows.map(r => r.old.length), 3)

    let count = 0

    for (const r of rows) {
      count++

      console.log(
        `_id: ${r.id.padEnd(idWidth)}  ${r.old.padEnd(oldWidth)} -> ${r.new}`
      )

      if (!dryRun) {
        await collection.updateOne(
          { _id: r.doc._id },
          { $set: { imageName: r.new } }
        )
      }
    }

    console.log(
      `Total entries ${dryRun ? 'to be changed' : 'changed'} in ${collectionName}: ${count}`
    )
  }

  console.log(
    dryRun
      ? '\nDry-run complete. No changes made. Use --no-dry-run to apply updates.'
      : '\nUpdate complete.'
  )
}

if (filename === process.argv[1]) {
  try {
    await main()
    process.exit(0)
  } catch (error) {
    console.error({ error })
    process.exit(1)
  }
}
