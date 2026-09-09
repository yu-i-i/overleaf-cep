import logger from '@overleaf/logger'
import { createClient } from 'webdav' // eslint-disable-line import/no-unresolved -- package is exports-map only (no main field); the legacy import resolver cannot read exports, but it resolves at runtime

import { ConflictError } from './ConflictErrors.mjs'

/**
 * Normalizes a file path for WebDAV compatibility.
 * Converts backslashes to forward slashes, removes duplicate slashes,
 * and ensures proper formatting with leading slash.
 * 
 * @param {string} value - The file path to normalize
 * @returns {string} Normalized path starting with '/'
 */
function normalizePath(value) {
  const path = `/${value || ''}`.replace(/\\/g, '/')
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

/**
 * Creates a WebDAV client instance for interacting with a WebDAV server.
 * 
 * @param {string} baseUrl - The base URL of the WebDAV server (e.g., 'https://nextcloud.example.com/remote.php/dav')
 * @param {string} username - Username for authentication
 * @param {string} password - Password or app token for authentication  
 * @param {string} [rootPath='/'] - Root path inside user's WebDAV home directory
 * @returns {Object} WebDAV client instance with methods: check, list, createDirectory, put, get, remove
 * 
 * @example
 * const client = createWebdavClient(
 *   'https://nextcloud.example.com/remote.php/dav',
 *   'alice', 
 *   'password123',
 *   '/Overleaf'
 * )
 */
export function createWebdavClient(baseUrl, username, password, rootPath = '/') {
  const parsed = new URL(baseUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('WebDAV URL must use HTTP or HTTPS')
  }

  // Normalize the root path
  const normalizedRootPath = normalizePath(rootPath)

  const urlStr = `${parsed.protocol}//${parsed.username ? `${parsed.username}:${parsed.password}@` : ''}${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
  
  const clientInstance = createClient(urlStr, {
    username,
    password,
  })

  logger.debug(
    { baseUrl, rootPath: normalizedRootPath },
    'WebDAV client initialized with webdav npm package'
  )

  // Return object implementing WebdavClient interface
  return {
    /**
     * Checks if the configured root path exists on the WebDAV server.
     * 
     * @returns {Promise<void>}
     * @throws {Error} If root path does not exist
     */
    async check() {
      const exists = await clientInstance.exists(normalizedRootPath)
      if (!exists) {
        throw new Error(`Root path does not exist: ${normalizedRootPath}`)
      }
      logger.debug({ rootPath: normalizedRootPath }, 'WebDAV check completed')
    },

    /**
     * Lists directory contents at the specified resource path.
     * 
     * @param {string} resourcePath - Path to list (relative to root)
     * @returns {Promise<Array>} Array of file/directory entries with href, path, isDirectory, etag, modifiedAt, size
     */
    async list(resourcePath) {
      const items = await clientInstance.getDirectoryContents(resourcePath)
      const parentPath = resourcePath.replace(/\/$/, '') || '/'
      return items.map(item => ({
        href: item.basename,
        path: item.filename || `${parentPath}/${item.basename}`.replace(/\/+/g, '/'),
        isDirectory: item.type === 'directory',
        etag: null,
        modifiedAt: item.lastmod ? new Date(item.lastmod).toISOString() : null,
        size: item.size || 0,
      }))
    },

    /**
     * Creates a new directory at the specified resource path.
     * 
     * @param {string} resourcePath - Path where the directory will be created
     * @returns {Promise<number>} HTTP status code (201 for creation, 405 if already exists)
     */
    async createDirectory(resourcePath) {
      await clientInstance.createDirectory(resourcePath)
      logger.debug({ resourcePath }, 'WebDAV directory created')
      return 201
    },

    /**
     * Uploads a file to the WebDAV server with optional ETag precondition.
     * 
     * @param {string} resourcePath - The path where the file will be stored (relative to root)
     * @param {Buffer|String} body - The file content to upload
     * @param {Object} [options] - Configuration options
     * @param {string} [options.etag] - Expected ETag for optimistic concurrency control
     * @returns {Promise<number>} HTTP status code (200 on success)
     * @throws {ConflictError} When ETag mismatch indicates remote file was modified
     */
    async put(resourcePath, body, { etag } = {}) {
      const content = Buffer.isBuffer(body)
        ? body
        : body instanceof ArrayBuffer
          ? Buffer.from(body)
          : ArrayBuffer.isView(body)
            ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
            : body

      await clientInstance.putFileContents(resourcePath, content, {
        overwrite: true,
        contentType: 'application/octet-stream',
        headers: etag ? { 'If-Match': etag } : undefined
      })
      
      logger.debug({ resourcePath }, 'WebDAV file put completed')
      return 200
    },

    /**
     * Downloads a file from the WebDAV server.
     * 
     * @param {string} resourcePath - Path to the file (relative to root)
     * @returns {Promise<Buffer>} File content as ArrayBuffer
     */
    async get(resourcePath) {
      const content = await clientInstance.getFileContents(resourcePath)
      if (typeof content === 'string') {
        return new TextEncoder().encode(content).buffer
      }
      return content
    },

    /**
     * Deletes a file from the WebDAV server.
     * 
     * @param {string} resourcePath - Path to the file (relative to root)
     * @returns {Promise<number>} HTTP status code (204 on success, 404 if not found)
     */
    async remove(resourcePath) {
      await clientInstance.deleteFile(resourcePath)
      logger.debug({ resourcePath }, 'WebDAV file removed')
      return 204
    },
  }
}

/**
 * Parses a WebDAV multistatus XML response into structured data.
 * Used for handling complex directory listing responses with multiple properties.
 * 
 * @param {string} xmlString - Raw XML response from WebDAV server
 * @param {string} relativePath - Relative path base for computing file paths
 * @param {string} endpointUrl - Endpoint URL for resolving absolute paths
 * @returns {Array} Array of parsed result objects with href, path, isDirectory, etag, modifiedAt, size
 */
export function parseMultistatus(xmlString, relativePath, endpointUrl) {
  if (!xmlString || typeof xmlString !== 'string') {
    throw new Error('invalid WebDAV multistatus response')
  }

  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml')

    // Check for parse errors
    const parseError = xmlDoc.querySelector('parsererror')
    if (parseError) {
      throw new Error('invalid WebDAV multistatus response')
    }

    const results = []
    const responses = xmlDoc.querySelectorAll('response')

    for (const response of responses) {
      const hrefEl = response.querySelector('href')
      const etagEl = response.querySelector('getetag')
      const contentLengthEl = response.querySelector('getcontentlength')
      const resType = response.querySelector('resourcetype')
      const modifiedEl = response.querySelector('getlastmodified')

      if (!hrefEl) continue

      const href = hrefEl.textContent
      const path = parseHrefToPath(href, relativePath, endpointUrl)

      results.push({
        href,
        path,
        isDirectory: !!resType?.querySelector('collection'),
        etag: etagEl?.textContent || null,
        modifiedAt: modifiedEl?.textContent
          ? new Date(modifiedEl.textContent).toISOString()
          : null,
        size: contentLengthEl ? parseInt(contentLengthEl.textContent, 10) : 0,
      })
    }

    return results
  } catch (error) {
    throw new Error('invalid WebDAV multistatus response')
  }
}

/**
 * Parses a WebDAV href value into a local file path.
 * Handles URL decoding and normalizes paths for consistency.
 * 
 * @param {string} href - Raw href from WebDAV response
 * @param {string} relativePath - Relative path base
 * @param {string} endpointUrl - Endpoint URL for comparison
 * @returns {string} Normalized local file path
 */
function parseHrefToPath(href, relativePath, endpointUrl) {
  // Remove port from endpointUrl for comparison if present
  let normalizedEndpoint = endpointUrl.replace(/:\d+$/, '')
  if (!normalizedEndpoint.endsWith('/')) {
    normalizedEndpoint += '/'
  }

  // Convert href to path
  let path = href
  if (path.startsWith(normalizedEndpoint)) {
    path = path.slice(normalizedEndpoint.length - 1)
  } else if (path.startsWith(relativePath)) {
    path = path.slice(relativePath.length)
  } else if (!path.startsWith('/')) {
    // Remove leading slash from relative paths
    path = '/' + path
  }

  // Decode URL encoding and remove trailing slash
  try {
    path = decodeURIComponent(path)
  } catch (e) {
    // Ignore decode errors
  }

  return path.replace(/\/$/, '') || '/'
}

/**
 * A wrapper class around the webdav npm client that provides
 * consistent error handling, retry logic, and Overleaf-specific features.
 */
export default class WebdavClient {
  /**
   * Creates a new WebDAV client instance.
   * 
   * @param {Object} options - Configuration options
   * @param {string} options.baseUrl - The base URL of the WebDAV server
   * @param {string} options.username - Username for authentication
   * @param {string} options.password - Password or app token for authentication
   * @param {string} [options.rootPath='/'] - Root path inside user's WebDAV home directory
   */
  constructor({ baseUrl, username, password, rootPath }) {
    const parsed = new URL(baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('WebDAV URL must use HTTP or HTTPS')
    }

    // Remove trailing slash from rootPath if present
    this.rootPath = normalizePath(rootPath)

    // Create webdav client instance using createClient from webdav package
    const urlStr = `${parsed.protocol}//${parsed.username ? `${parsed.username}:${parsed.password}@` : ''}${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
    
    this.client = createClient(urlStr, {
      username,
      password,
    })

    logger.debug(
      { baseUrl, rootPath },
      'WebDAV client initialized with webdav npm package'
    )
  }

  /**
   * Builds a full WebDAV URL for a given resource path.
   * 
   * @param {string} path - Resource path relative to root
   * @returns {URL} Full URL to the resource
   */
  url(path) {
    const baseUrl = this.client.baseUrl.replace(/\/$/, '')
    const fullPath = `${baseUrl}/${normalizePath(path).replace(/^\//, '')}`
    return new URL(fullPath)
  }

  /**
   * Checks if the configured root path exists and is accessible.
   * Uses the internal client instance with retry logic.
   * 
   * @returns {Promise<void>}
   * @throws {Error} If root path does not exist or access fails
   */
  async check() {
    try {
      const exists = await this._executeWithRetry(() => this.client.exists(this.rootPath))
      if (!exists) {
        throw new Error(`Root path does not exist: ${this.rootPath}`)
      }
      logger.debug({ rootPath: this.rootPath }, 'WebDAV check completed')
    } catch (error) {
      logger.error(
        { err: error, rootPath: this.rootPath },
        'WebDAV check failed'
      )
      throw error
    }
  }

  /**
   * Lists directory contents at the specified resource path using retry logic.
   * 
   * @param {string} resourcePath - Path to list (relative to root)
   * @returns {Promise<Array>} Array of file/directory entries with metadata
   */
  async list(resourcePath) {
    try {
      const items = await this._executeWithRetry(() => this.client.getDirectoryContents(resourcePath))
      
      logger.debug(
        { resourcePath, itemCount: items.length },
        'WebDAV list completed'
      )
      
      // Transform response to match expected format
      return items.map(item => ({
        href: item.basename,
        path: item.basename,
        isDirectory: item.type === 'directory',
        etag: null, // webdav package doesn't expose etag in getDirectoryContents by default
        modifiedAt: item.lastmod ? new Date(item.lastmod).toISOString() : null,
        size: item.size || 0,
      }))
    } catch (error) {
      logger.error(
        { err: error, resourcePath },
        'WebDAV list failed'
      )
      throw error
    }
  }

  /**
   * Creates a new directory using the internal client with retry logic.
   * 
   * @param {string} resourcePath - Path where the directory will be created
   * @returns {Promise<number>} HTTP status code (201 for creation)
   */
  async createDirectory(resourcePath) {
    try {
      await this._executeWithRetry(() => this.client.createDirectory(resourcePath))
      logger.debug({ resourcePath }, 'WebDAV directory created')
      return 201
    } catch (error) {
      if (error.status === 405 || error.message?.includes('ALREADY_EXISTS')) {
        // Directory already exists - this is the expected behavior for MKCOL
        logger.debug(
          { resourcePath, message: error.message },
          'WebDAV directory already exists'
        )
        return 405
      }
      logger.error({ err: error, resourcePath }, 'WebDAV mkdir failed')
      throw error
    }
  }

  // Retry configuration for transient errors (env-overridable per runtime config)
  _maxRetries = Math.max(0, Number.parseInt(process.env.WEBDAV_RETRY_COUNT ?? '', 10) || 2)
  _retryDelayMs = Number.parseInt(process.env.WEBDAV_RETRY_DELAY_MS ?? '', 10) || 100
  // NOTE: per-request timeout is enforced by the webdavinterface microservice (WEBDAV_REQUEST_TIMEOUT_MS); the webdav npm transport does not expose an AbortController surface, so this value is informational here.
  _requestTimeoutMs = Number.parseInt(process.env.WEBDAV_REQUEST_TIMEOUT_MS ?? '', 10) || 10000

  /**
   * Executes an operation with retry logic for transient errors.
   * Retries on HTTP 423 (Locked), 502, 503, 504 with exponential backoff.
   * 
   * @param {function} operation - Async function to execute
   * @returns {Promise<any>} Result of the operation
   * @throws {Error} Last error if all retries exhausted
   */
  async _executeWithRetry(operation) {
    let lastError
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        // Retry on transient server errors
        if (
          error.status === 423 ||         // Locked
          error.status === 502 ||         // Bad Gateway  
          error.status === 503 ||         // Service Unavailable
          error.status === 504           // Gateway Timeout
        ) {
          const delay = this._retryDelayMs * Math.pow(2, attempt)
          await new Promise(resolve => setTimeout(resolve, delay))
        } else {
          throw error
        }
      }
    }
    throw lastError
  }

  /**
   * Uploads a file with ETag-based concurrency control.
   * Throws ConflictError on 412 Precondition Failed.
   * 
   * @param {string} resourcePath - Path where the file will be stored
   * @param {Buffer|String} body - File content to upload
   * @param {Object} [options] - Configuration options
   * @param {string} [options.etag] - Expected ETag for concurrency control
   * @returns {Promise<number>} HTTP status code (200 on success)
   */
   async put(resourcePath, body, { etag } = {}) {
     try {
       // Convert ArrayBuffer/Buffer to string if needed
       const content = 
         typeof body === 'string' ? body :
         body instanceof ArrayBuffer ? new TextDecoder().decode(body) :
         Buffer.isBuffer(body) ? body :  // ← Keep binary buffers as-is!
         body

       await this._executeWithRetry(() => this.client.putFileContents(resourcePath, content, {
         overwrite: true,
         contentType: 'application/octet-stream',
         headers: etag ? { 'If-Match': etag } : undefined
       }))
       
       logger.debug({ resourcePath }, 'WebDAV file put completed')
       return 200
     } catch (error) {
       if (error.status === 412 || error.message?.includes('Precondition')) {
         // Precondition failed - etag mismatch indicates conflict
         const details = {
           statusCode: error.status,
           resourcePath,
           expectedETag: etag,
           message: error.message || 'File has been modified by someone else',
         }
         throw new ConflictError(
           `WebDAV precondition failed (412) for ${resourcePath}`,
           details
         )
       }
       logger.error({ err: error, resourcePath }, 'WebDAV put failed')
       throw error
     }
   }

  /**
   * Downloads a file from the WebDAV server.
   * 
   * @param {string} resourcePath - Path to the file (relative to root)
   * @returns {Promise<Buffer>} File content as ArrayBuffer
   */
  async get(resourcePath) {
    try {
      const content = await this._executeWithRetry(() => this.client.getFileContents(resourcePath))
      
      // webdav package returns content as string by default
      // Convert to ArrayBuffer matching previous behavior
      if (typeof content === 'string') {
        return new TextEncoder().encode(content).buffer
      }
      return content
    } catch (error) {
      logger.error({ err: error, resourcePath }, 'WebDAV get failed')
      throw error
    }
  }

  /**
   * Deletes a file from the WebDAV server.
   * 
   * @param {string} resourcePath - Path to the file (relative to root)
   * @returns {Promise<number>} HTTP status code (204 on success, 404 if not found)
   */
  async remove(resourcePath) {
    try {
      await this._executeWithRetry(() => this.client.deleteFile(resourcePath))
      logger.debug({ resourcePath }, 'WebDAV file removed')
      return 204
    } catch (error) {
      if (error.status === 404 || error.message?.includes('NOT_FOUND')) {
        logger.debug({ resourcePath }, 'WebDAV file already removed')
        return 404
      }
      logger.error({ err: error, resourcePath }, 'WebDAV remove failed')
      throw error
    }
  }

  /**
   * Moves a file within the WebDAV server.
   * 
   * @param {string} sourcePath - Current path of the file
   * @param {string} destinationPath - New path for the file
   * @returns {Promise<number>} HTTP status code (201 on success)
   */
  async move(sourcePath, destinationPath) {
    try {
      await this._executeWithRetry(() => this.client.moveFile(sourcePath, destinationPath, {
        overwrite: true,
      }))
      logger.debug(
        { sourcePath, destinationPath },
        'WebDAV file moved'
      )
      return 201
    } catch (error) {
      if (error.status === 404 || error.message?.includes('NOT_FOUND')) {
        logger.error({ err: error }, 'WebDAV move failed - source not found')
        throw error
      }
      logger.error(
        { err: error, sourcePath, destinationPath },
        'WebDAV move failed'
      )
      throw error
    }
  }
}