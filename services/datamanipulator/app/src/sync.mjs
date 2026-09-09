import * as fileOperations from './fileOperations.mjs'
import * as treeCompare from './treeCompare.mjs'

/**
 * Get metadata for a single file
 * @param {string} projectDir - Absolute path to project directory
 * @param {string} relativePath - File path within project
 * @returns {Object} File entry with metadata
 */
async function getFileEntry(projectDir, relativePath) {
  const file = await fileOperations.readFile(projectDir, relativePath)
  return {
    relative_path: relativePath,
    name: file.name || relativePath.split('/').pop(),
    type: 'file',
    size: file.size,
    checksum: file.checksum,
    etag: `sha256:${file.checksum.split(':')[1]}|${file.mtime}`,
    binary: file.binary
  }
}

/**
 * Pull files from remote to local (download only changed files)
 * @param {string} projectDir - Absolute path to local project directory
 * @param {Array} remoteFiles - Array of remote file entries with metadata
 * @returns {Object} Sync results with counts and conflicts
 */
export async function pullFiles(projectDir, remoteFiles, options = {}) {
  const result = {
    downloaded: 0,
    skipped: 0,
    deleted: 0,
    conflicts: []
  }

  // ARC-06 guard: an EMPTY remote listing is almost certainly an incomplete
  // or failed listing upstream — never derive deletions from it.
  // RF.7: callers that pull ONE known project folder (where an empty folder
  // is a legitimate state) may opt out via options.allowEmptyRemote.
  if (!remoteFiles || remoteFiles.length === 0) {
    if (!options?.allowEmptyRemote) {
      throw new Error(
        'remote file listing is empty; refusing to derive deletions (possible incomplete listing)'
      )
    }
  }

  // Get current local tree
  const localTree = await fileOperations.walkTree(projectDir)
  
  // Build maps for comparison
  const localMap = new Map()
  localTree.entries.forEach(e => localMap.set(e.relative_path, e))
  
  const remoteMap = new Map()
  remoteFiles.forEach(f => remoteMap.set(f.relative_path, f))

  // Process each remote file
  for (const [path, remoteFile] of remoteMap) {
    if (!localMap.has(path)) {
      // New file - download it
      try {
        const contentBuffer = Buffer.from(remoteFile.content_base64 || '', 'base64')
        await fileOperations.writeFile(projectDir, path, contentBuffer)
        result.downloaded++
      } catch (err) {
        console.warn({ path, message: err.message }, 'Failed to download file')
      }
    } else {
      // File exists locally - compare checksums
      const localFile = localMap.get(path)
      
      if (!remoteFile.checksum || !localFile.checksum) {
        // No checksums available, skip for safety
        result.skipped++
        continue
      }

      if (localFile.checksum === remoteFile.checksum) {
        // Identical content - skip
        result.skipped++
      } else {
        // Different content - conflict
        const localEtag = localFile.etag || `sha256:${localFile.checksum}|${localFile.mtime}`
        const remoteEtag = remoteFile.etag || `sha256:${remoteFile.checksum}|${remoteFile.mtime}`
        
        result.conflicts.push({
          path,
          local_etag: localEtag,
          remote_etag: remoteEtag
        })
      }
    }
  }

  // Files missing from the remote listing are only deleted when the caller
  // EXPLICITLY confirmed the deletions (ARC-06: a plain listing must never
  // silently wipe local data; it is reported as skipped_deletions instead).
  const deletablePaths = []
  for (const [path] of localMap) {
    if (!remoteMap.has(path)) deletablePaths.push(path)
  }
  if (deletablePaths.length > 0) {
    if (options.confirm_remote_deletions === true) {
      const allowed = new Set(options.deleted_paths || deletablePaths)
      for (const path of deletablePaths) {
        if (!allowed.has(path)) continue
        try {
          await fileOperations.deletePath(projectDir, path)
          result.deleted++
        } catch (err) {
          console.warn({ path, message: err.message }, 'Failed to delete removed file')
        }
      }
    } else {
      // Default: no destructive deletion; report what WOULD be deleted.
      result.skipped_deletions = deletablePaths
    }
  }

  return result
}

/**
 * Push files from local to remote (local side only: validates that each local
 * file is readable and reports what WOULD be uploaded. This service has no
 * remote transport; the caller performs the transfer.)
 * @param {string} projectDir - Absolute path to local project directory
 * @param {Array} remoteFiles - Array of remote file entries with metadata
 * @returns {Object} Local push-preparation counts
 */
export async function pushFiles(projectDir, remoteFiles) {
  const result = {
    uploaded: 0,
    skipped: 0,
    deleted_remote: 0
  }

  // Get current local tree
  const localTree = await fileOperations.walkTree(projectDir)
  
  // Build maps for comparison
  const localMap = new Map()
  localTree.entries.forEach(e => localMap.set(e.relative_path, e))
  
  const remoteMap = new Map()
  remoteFiles.forEach(f => remoteMap.set(f.relative_path, f))

  // Process each local file
  for (const [path, localFile] of localMap) {
    if (!remoteMap.has(path)) {
      // New file - would upload it
      try {
        await fileOperations.readFile(projectDir, path)
        result.uploaded++
      } catch (err) {
        console.warn({ path, message: err.message }, 'Failed to read file for push')
      }
    } else {
      // File exists remotely - compare checksums
      const remoteFile = remoteMap.get(path)
      
      if (!localFile.checksum || !remoteFile.checksum) {
        result.skipped++
        continue
      }

      if (localFile.checksum === remoteFile.checksum) {
        // Identical content - skip
        result.skipped++
      } else {
        // Different content - would upload
        try {
          await fileOperations.readFile(projectDir, path)
          result.uploaded++
        } catch (err) {
          console.warn({ path, message: err.message }, 'Failed to upload modified file')
        }
      }
    }
  }

  // Check for files deleted locally (only in remote)
  for (const [path] of remoteMap) {
    if (!localMap.has(path)) {
      result.deleted_remote++
      // In real implementation, would delete from remote
    }
  }

  return result
}

/**
 * Full sync with conflict detection and resolution suggestions
 * @param {string} projectDir - Absolute path to local project directory
 * @param {Array} remoteFiles - Array of remote file entries with metadata
 * @returns {Object} Complete sync summary
 */
export async function fullSync(projectDir, remoteFiles) {
  const result = {
    summary: {},
    conflicts: [],
    only_local: [],
    only_remote: [],
    identical: []
  }

  // Get local tree
  const localTree = await fileOperations.walkTree(projectDir)
  
  // Build maps
  const localMap = new Map()
  localTree.entries.forEach(e => localMap.set(e.relative_path, e))
  
  const remoteMap = new Map()
  remoteFiles.forEach(f => remoteMap.set(f.relative_path, f))

  // Compare trees using treeCompare module
  const comparison = treeCompare.compareTrees(localTree, { entries: remoteFiles })

  result.conflicts = comparison.conflicts.map(c => ({
    path: c.path || c.relative_path,
    local_etag: `sha256:${c.leftChecksum?.split(':')[1] || ''}|${localMap.get(c.path)?.mtime}`,
    remote_etag: `sha256:${c.rightChecksum?.split(':')[1] || ''}|${remoteMap.get(c.path)?.mtime}`
  }))

  result.only_local = comparison.onlyInLeft
  result.only_remote = comparison.onlyInRight
  result.identical = comparison.identical

  // Add summary counts
  result.summary = {
    total_files: localTree.totalFiles,
    conflicts_count: result.conflicts.length,
    only_local_count: result.only_local.length,
    only_remote_count: result.only_remote.length,
    identical_count: result.identical.length
  }

  return result
}

/**
 * Resolve a conflict by comparing mtimes (newer wins)
 * @param {Object} localFile - Local file entry
 * @param {Object} remoteFile - Remote file entry  
 * @returns {'left'|'right'|'needs_review'} Resolution decision
 */
export function resolveConflictByMtime(localFile, remoteFile) {
  try {
    const localTime = new Date(localFile.mtime).getTime()
    const remoteTime = new Date(remoteFile.mtime).getTime()

    if (localTime > remoteTime) return 'left'  // Local is newer
    if (remoteTime > localTime) return 'right' // Remote is newer
    return 'needs_review' // Same mtime, requires manual review
  } catch (err) {
    // If date parsing fails, default to needs_review
    console.warn({ message: err.message }, 'Failed to compare mtimes')
    return 'needs_review'
  }
}

export default {
  pullFiles,
  pushFiles,
  fullSync,
  resolveConflictByMtime,
  getFileEntry,
  compareTrees: treeCompare.compareTrees
}
