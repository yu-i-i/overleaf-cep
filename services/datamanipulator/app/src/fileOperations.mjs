import logger from '@overleaf/logger'
import Path from 'node:path'
import { FileNotFoundError, DirectoryNotFoundError } from './errors.mjs'
import * as fileUtils from './fileUtils.mjs'

function resolveProjectPath(projectDir, relativePath) {
  const root = Path.resolve(projectDir)
  const resolved = Path.resolve(root, relativePath || '')
  if (resolved !== root && !resolved.startsWith(`${root}${Path.sep}`)) {
    throw new Error('Path must stay within the project directory')
  }
  return resolved
}

/**
 * Walk directory tree and build file metadata
 * @param {string} projectDir - Absolute path to project directory
 * @param {string} basePath - Relative path within project (for output)
 * @returns {Object} File tree structure
 */
export async function walkTree(projectDir, basePath = '') {
  const fs = await import('fs/promises')
  const Path = await import('path')

  const result = {
    entries: [],
    totalFiles: 0,
    totalSize: 0
  }

  async function walk(currentPath, relativeBase) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = Path.join(currentPath, entry.name)
        const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name

        // D2 / M5: hidden entries and LaTeX build transients never enter the
        // synced tree (no listing, no recursion, no checksumming).
        if (fileUtils.isSyncExcluded(relPath)) {
          continue
        }

        if (entry.isDirectory()) {
          result.entries.push({
            relative_path: relPath,
            name: entry.name,
            type: 'directory',
            depth: relPath.split('/').length - 1
          })

          // Recurse into subdirectories, skip node_modules (kept listed but
          // never recursed — pre-existing behaviour, unaffected by D2).
          if (entry.name !== 'node_modules') {
            await walk(fullPath, relPath)
          }
        } else if (entry.isFile()) {
          try {
            const buffer = await fs.readFile(fullPath)
            const metadata = fileUtils.getFileMetadata(relPath, buffer)

            result.entries.push(metadata)
            result.totalFiles++
            result.totalSize += buffer.length
          } catch {
            logger.warn({ path: relPath, message: 'Failed to read file' }, 'File read error')
          }
        }
      }
    } catch {
      throw new DirectoryNotFoundError(currentPath)
    }
  }

  await walk(projectDir, basePath)
  return result
}

/**
 * Read a single file with metadata
 * @param {string} projectDir - Absolute path to project directory
 * @param {string} relativePath - File path within project
 * @returns {Object} File content and metadata
 */
export async function readFile(projectDir, relativePath) {
  const fs = await import('fs/promises')

  const fullPath = resolveProjectPath(projectDir, relativePath)

  try {
    const buffer = await fs.readFile(fullPath)
    const stats = await fs.stat(fullPath)
    return {
      content_base64: buffer.toString('base64'),
      size: buffer.length,
      ...fileUtils.getFileMetadata(relativePath, buffer),
      // DM-04: real file mtime (scan time made mtime/etag conflict logic meaningless)
      mtime: stats.mtime.toISOString()
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new FileNotFoundError(relativePath)
    }
    throw err
  }
}

/**
 * Write a file to the project directory
 * @param {string} projectDir - Absolute path to project directory
 * @param {string} relativePath - File path within project
 * @param {Buffer|String} content - File content (auto-detected)
 * @returns {Object} File metadata after write
 */
export async function writeFile(projectDir, relativePath, content) {
  const fs = await import('fs/promises')

  // Ensure parent directory exists
  const fullPath = resolveProjectPath(projectDir, relativePath)
  const dirPath = Path.dirname(fullPath)

  try {
    await fs.mkdir(dirPath, { recursive: true })

    let buffer
    if (Buffer.isBuffer(content)) {
      buffer = content
    } else {
      buffer = Buffer.from(content, 'utf8')
    }

    await fs.writeFile(fullPath, buffer)

    // Return metadata
    return fileUtils.getFileMetadata(relativePath, buffer)
  } catch (err) {
    logger.error({ err, path: relativePath }, 'Failed to write file')
    throw err
  }
}

/**
 * Delete a file or directory
 * @param {string} projectDir - Absolute path to project directory
 * @param {string} relativePath - Path within project
 */
export async function deletePath(projectDir, relativePath) {
  const fs = await import('fs/promises')

  const fullPath = resolveProjectPath(projectDir, relativePath)

  try {
    const stats = await fs.stat(fullPath)
    if (stats.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: true })
    } else {
      await fs.unlink(fullPath)
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new FileNotFoundError(relativePath)
    }
    throw err
  }
}

export default {
  walkTree,
  readFile,
  writeFile,
  deletePath
}
