
import crypto from 'crypto'

export const FileTypes = {
  TEXT: 'text',
  BINARY: 'binary'
}

/**
 * D2 / M5: shared sync-exclusion filter. Files and directories matching
 * these patterns (LaTeX build transients, hidden entries) are excluded from
 * the synced file set: they never appear in /tree, are never read for push,
 * never applied from pull, and never participate in tree comparison.
 * @param {string} name - file name or relative path
 * @returns {boolean} true when the entry must be excluded from sync
 */
export function isSyncExcluded(name) {
  if (!name) return true
  // RF.5: hidden component in ANY segment (the old check only inspected the
  // first and last segment, so e.g. 'sub/.git/config' slipped through).
  const parts = String(name).split('/').filter(Boolean)
  if (!parts.length) return true
  for (const part of parts) {
    if (part.startsWith('.')) return true
  }
  const base = parts[parts.length - 1]
  return /\.(aux|log|out|toc|fls|idx|vrb)$/i.test(base) || /\.synctex\.gz$/i.test(base)
}

/**
 * Detect if a file is binary based on extension and content sample
 * @param {string} filepath - Path to the file (for extension check)
 * @param {Buffer} buffer - File content bytes
 * @returns {{ type: 'text'|'binary', encoding?: string }} Detection result
 */
export function detectFileType(filepath, buffer) {
  const binaryExts = new Set([
    'pdf', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'ttf', 'woff',
    'woff2', 'eot', 'ico', 'exe', 'msi', 'bin', 'tar', 'gz',
    'rar', '7z', 'img', 'iso', 'dmg'
  ])

  const ext = filepath.split('.').pop()?.toLowerCase() || ''

  // Fast path: extension-based detection
  if (binaryExts.has(ext)) {
    return { type: FileTypes.BINARY }
  }

  // Content-based detection for unknown extensions
  if (!buffer || buffer.length === 0) {
    return { type: FileTypes.TEXT, encoding: 'utf8' }
  }

  const sampleSize = Math.min(buffer.length, 8192)
  const sample = buffer.slice(0, sampleSize)

  // Check for null bytes (>5% null = binary)
  let nullCount = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      nullCount++
      if (nullCount > sample.length * 0.05) {
        return { type: FileTypes.BINARY }
      }
    }
  }

  // Try to decode as UTF-8
  try {
    const decoder = new TextDecoder('utf8', { fatal: true })
    decoder.decode(sample)
    return { type: FileTypes.TEXT, encoding: 'utf8' }
  } catch {
    // Not UTF-8. M8: byte range check was tautological; simplified.
    // (Bytes from a Buffer are always 0..255, so the old per-byte loop
    // could never fail; behaviour is preserved without the dead loop.)
    if (nullCount === 0) {
      return { type: FileTypes.TEXT, encoding: 'latin1' }
    }

    return { type: FileTypes.BINARY }
  }
}

/**
 * Calculate SHA256 checksum of file content
 * @param {Buffer} buffer - File content
 * @returns {string} Checksum in format "sha256:hexdigest"
 */
export function calculateChecksum(buffer) {
  if (!buffer || buffer.length === 0) {
    return 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // Empty file hash
  }

  try {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    return `sha256:${hash}`
  } catch {
    console.warn("Failed to calculate checksum")
    return `sha256:placeholder-${buffer.length}`
  }
}

/**
 * Get file metadata for a single file
 * @param {string} filepath - Relative path within project
 * @param {Buffer} buffer - File content
 * @returns {Object} Metadata object
 */
export function getFileMetadata(filepath, buffer) {
  const { type, encoding } = detectFileType(filepath, buffer)
  return {
    relative_path: filepath,
    name: filepath.split('/').pop() || filepath,
    type: 'file',
    size: buffer.length,
    binary: type === FileTypes.BINARY,
    checksum: calculateChecksum(buffer),
    mtime: new Date().toISOString(),
    ...(encoding && { encoding })
  }
}

export default {
  FileTypes,
  detectFileType,
  calculateChecksum,
  getFileMetadata,
  isSyncExcluded
}
