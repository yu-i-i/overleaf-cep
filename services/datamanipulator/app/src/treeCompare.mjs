import logger from '@overleaf/logger'
import { isSyncExcluded } from './fileUtils.mjs'

/**
 * Compare two file trees and identify differences
 * @param {Object} leftTree - First tree structure (from project A)
 * @param {Object} rightTree - Second tree structure (from project B)
 * @returns {Object} Comparison results with conflicts, added, removed,
 *   identical, unknown (no checksums and equal size — content NOT verified)
 */
export function compareTrees(leftTree, rightTree) {
  const result = {
    conflicts: [],
    onlyInLeft: [],
    onlyInRight: [],
    identical: [],
    unknown: []
  }

  // Build maps for faster lookup.
  // D2: sync-excluded entries (LaTeX transients, hidden) are dropped from
  // BOTH sides so they can never produce added/removed/changed classes.
  const leftMap = new Map()
  leftTree.entries.forEach(e => {
    if (isSyncExcluded(e.relative_path)) return
    leftMap.set(e.relative_path, e)
  })

  const rightMap = new Map()
  rightTree.entries.forEach(e => {
    if (isSyncExcluded(e.relative_path)) return
    rightMap.set(e.relative_path, e)
  })

  // Find differences
  for (const [path, leftEntry] of leftMap) {
    if (!rightMap.has(path)) {
      result.onlyInLeft.push(leftEntry)
    } else {
      const rightEntry = rightMap.get(path)
      
      if (leftEntry.checksum && rightEntry.checksum) {
        if (leftEntry.checksum === rightEntry.checksum) {
          result.identical.push({ path, checksum: leftEntry.checksum })
        } else {
          result.conflicts.push({
            path,
            leftChecksum: leftEntry.checksum,
            rightChecksum: rightEntry.checksum
          })
        }
      } else {
        // M6: no checksums on either side — an equal size does NOT prove
        // identical content. Classify as `unknown` (reported, never treated
        // as equal) instead of `identical`.
        if (leftEntry.size === rightEntry.size) {
          result.unknown.push({
            path,
            size: leftEntry.size,
            note: 'checksums unavailable; equal size is not proof of identical content'
          })
        } else {
          result.conflicts.push({
            path,
            leftSize: leftEntry.size,
            rightSize: rightEntry.size,
            note: 'size mismatch (checksums unavailable)'
          })
        }
      }
    }
  }

  // Find files only in right tree
  for (const [path] of rightMap) {
    if (!leftMap.has(path)) {
      result.onlyInRight.push(rightMap.get(path))
    }
  }

  logger.debug({
    conflicts: result.conflicts.length,
    onlyInLeft: result.onlyInLeft.length,
    onlyInRight: result.onlyInRight.length,
    identical: result.identical.length,
    unknown: result.unknown.length
  }, 'Tree comparison complete')

  return result
}

export default { compareTrees }
