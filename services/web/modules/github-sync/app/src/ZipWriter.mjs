// Minimal ZIP writer (store method, no compression) — pure Node, no deps.
//
// `createProjectFromZipArchiveWithName` extracts via yauzl (ArchiveManager),
// which reads STORED entries fine; this writer covers the import flow
// (GitHub clone dir → project) without adding a zip library.
//
// Supports only what that flow needs: files (no symlinks/dirs/extra fields),
// UTF-8 filenames (flag 0x0800 set).

import fs from 'node:fs/promises'
import Path from 'node:path'

// CRC32 (IEEE 802.3, same table the `zip` utility uses)
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ -1) >>> 0
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear())
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate())
  return { time, date }
}

async function walkFiles(dir, prefix, ignore, out) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const abs = Path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (ignore && ignore.test(rel)) continue
    let stats
    try {
      stats = await fs.stat(abs) // follows symlinks
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      await walkFiles(abs, rel, ignore, out)
    } else if (stats.isFile()) {
      out.push({ abs, rel })
    }
  }
}

/**
 * Create a STORED (uncompressed) zip of `srcDir` (relative paths inside the
 * archive), skipping entries whose relative path matches `options.ignore`.
 */
async function writeStoredZip(srcDir, outZipPath, options = {}) {
  const files = []
  await walkFiles(srcDir, '', options.ignore, files)

  const chunks = []
  const central = []
  let offset = 0
  const { time, date } = dosDateTime(new Date())

  for (const file of files) {
    const data = await fs.readFile(file.abs)
    const nameBuf = Buffer.from(file.rel, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 name
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18) // compressed size
    local.writeUInt32LE(data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length

    chunks.push(local, nameBuf, data)

    const centry = Buffer.alloc(46)
    centry.writeUInt32LE(0x02014b50, 0) // central dir signature
    centry.writeUInt16LE(20, 4) // version made by
    centry.writeUInt16LE(20, 6) // version needed
    centry.writeUInt16LE(0x0800, 8) // flags
    centry.writeUInt16LE(0, 10) // method
    centry.writeUInt16LE(time, 12)
    centry.writeUInt16LE(date, 14)
    centry.writeUInt32LE(crc, 16)
    centry.writeUInt32LE(data.length, 20)
    centry.writeUInt32LE(data.length, 24)
    centry.writeUInt16LE(nameBuf.length, 28)
    // extra/comment/disk/attrs: zero
    centry.writeUInt32LE(0, 38) // external attrs
    centry.writeUInt32LE(offset, 42) // local header offset

    central.push(Buffer.concat([centry, nameBuf]))
    offset += local.length + nameBuf.length + data.length
  }

  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8) // entries on this disk
  eocd.writeUInt16LE(files.length, 10) // total entries
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16) // central dir offset

  await fs.writeFile(outZipPath, Buffer.concat([...chunks, cdBuf, eocd]))
  return { entryCount: files.length }
}

export { writeStoredZip }
export default { writeStoredZip }
