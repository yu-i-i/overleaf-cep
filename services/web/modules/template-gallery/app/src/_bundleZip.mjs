import yauzl from 'yauzl'
import OError from '../../../../app/src/Features/Errors/Errors.js'

const MAX_BUNDLE_ENTRY_BYTES = 40 * 1024 * 1024

/**
 * 3b: read the bundle zip in memory. Returns a Map of entry name ->
 * Buffer for the three entries the bundle format defines
 * (template.json, source.zip, output.pdf). Unknown entries are ignored.
 */
export function readZipEntries(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, strictSLA: false }, (err, zipFile) => {
      if (err) {
        return reject(new OError('Invalid bundle (not a readable zip)', { status: 400 }))
      }
      const out = new Map()
      zipFile.on('error', (e) =>
        reject(new OError('Invalid bundle (zip read error)', { status: 400 }))
      )
      zipFile.on('entry', (entry) => {
        const name = entry.fileName
        if (
          name !== 'template.json' &&
          name !== 'source.zip' &&
          name !== 'output.pdf'
        ) {
          return zipFile.readEntry()
        }
        if (entry.fileSize > MAX_BUNDLE_ENTRY_BYTES) {
          return reject(
            new OError('Bundle entry too large', { status: 413 })
          )
        }
        zipFile.openReadStream(entry, (rErr, readStream) => {
          if (rErr || !readStream) {
            return reject(
              new OError('Bundle entry unreadable', { status: 400 })
            )
          }
          const chunks = []
          readStream.on('data', (c) => chunks.push(c))
          readStream.on('end', () => {
            out.set(name, Buffer.concat(chunks))
            zipFile.readEntry()
          })
          readStream.on('error', () =>
            reject(new OError('Bundle entry read error', { status: 400 }))
          )
          // drain even if we never look at it further
        })
      })
      zipFile.on('end', () => resolve(out))
      zipFile.readEntry()
    })
  })
}

/**
 * R6 item 5 (2026-08-29): list ALL entry names of a zip without reading
 * contents. (readZipEntries only extracts the three bundle entries, so
 * it cannot be used to inspect the inner source.zip.)
 */
export function listZipEntryNames(buf) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, strictSLA: false }, (err, zipFile) => {
      if (err) {
        return reject(new OError('Invalid zip archive', { status: 400 }))
      }
      const names = []
      zipFile.on('error', (e) => reject(new OError('Zip read error', { status: 400 })))
      zipFile.on('entry', (entry) => {
        names.push(entry.fileName)
        zipFile.readEntry()
      })
      zipFile.on('end', () => resolve(names))
      zipFile.readEntry()
    })
  })
}
