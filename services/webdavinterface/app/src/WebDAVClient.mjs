import { createClient } from 'webdav'
import { validateAuth } from './auth.mjs'
import logger from '@overleaf/logger'

export class WebDAVClient {
  constructor({ baseUrl, username, password }) {
    if (!validateAuth({ username, password })) {
      throw new Error('Missing authentication credentials')
    }
    
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this._maxRetries = 2
    this._retryDelayMs = 100
    
    const parsed = new URL(this.baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('WebDAV URL must use HTTP or HTTPS')
    }

    let authPart = ''
    if (parsed.username && parsed.password) {
      authPart = `${parsed.username}:${parsed.password}@`
    }
    
    const urlStr = `${parsed.protocol}//${authPart}${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
    
    this.client = createClient(urlStr, { username, password })
  }

  async _executeWithRetry(operation) {
    let lastError
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        
        if (
          error.status === 423 ||
          error.status === 502 ||
          error.status === 503 ||
          error.status === 504
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

  async list(resourcePath) {
    try {
      const items = await this.client.getDirectoryContents(resourcePath)
      const parentPath = resourcePath.replace(/\/$/, '') || '/'
      
      return items.map(item => ({
        href: item.basename,
        path: item.filename || `${parentPath}/${item.basename}`.replace(/\/+/g, '/'),
        isDirectory: item.type === 'directory',
        etag: item.etag || null,
        modifiedAt: item.lastmod ? new Date(item.lastmod).toISOString() : null,
        size: item.size || 0
      }))
    } catch (error) {
      logger.error({ err: error, resourcePath }, 'WebDAV list failed')
      throw error
    }
  }

  async download(resourcePath) {
    try {
      const content = await this.client.getFileContents(resourcePath)
      
      if (typeof content === 'string') {
        return Buffer.from(content, 'utf8').toString('base64')
      }
      return Buffer.from(content).toString('base64')
    } catch (error) {
      logger.error({ err: error, resourcePath }, 'WebDAV download failed')
      throw error
    }
  }

  async upload(resourcePath, contentBase64, { etag } = {}) {
    const contentBuffer = Buffer.from(contentBase64, 'base64')

    try {
      const parentPath = resourcePath.slice(0, resourcePath.lastIndexOf('/')) || '/'
      await this.client.createDirectory(parentPath, { recursive: true })

      const putOptions = {
        overwrite: true,
        contentType: 'application/octet-stream',
        headers: etag ? { 'If-Match': etag } : undefined
      }

      try {
        await this.client.putFileContents(resourcePath, contentBuffer, putOptions)
      } catch (error) {
        if (error.status !== 404) throw error

        await this.client.createDirectory(parentPath, { recursive: true })
        await this.client.putFileContents(resourcePath, contentBuffer, putOptions)
      }
      
      logger.debug({ resourcePath }, 'WebDAV upload completed')
      return { success: true }
    } catch (error) {
      if (error.status === 412 || error.message?.includes('Precondition')) {
        const conflictError = new Error(`Upload conflict: ETag mismatch`)
        conflictError.cause = error
        throw conflictError
      }
      
      logger.error({ err: error, resourcePath }, 'WebDAV upload failed')
      throw error
    }
  }

  async delete(resourcePath) {
    try {
      await this.client.deleteFile(resourcePath)
      logger.debug({ resourcePath }, 'WebDAV file deleted')
      return { success: true }
    } catch (error) {
      if (error.status === 404 || error.message?.includes('NOT_FOUND')) {
        logger.debug({ resourcePath }, 'WebDAV file already removed')
        return { success: true, notFound: true }
      }
      
      logger.error({ err: error, resourcePath }, 'WebDAV delete failed')
      throw error
    }
  }

  async createDirectory(resourcePath) {
    try {
      await this.client.createDirectory(resourcePath)
      logger.debug({ resourcePath }, 'WebDAV directory created')
      return { success: true, created: true }
    } catch (error) {
      if (error.status === 405 || error.message?.includes('ALREADY_EXISTS')) {
        logger.debug({ resourcePath }, 'WebDAV directory already exists')
        return { success: true, created: false }
      }
      
      logger.error({ err: error, resourcePath }, 'WebDAV mkdir failed')
      throw error
    }
  }

  async move(sourcePath, destinationPath) {
    try {
      await this.client.moveFile(sourcePath, destinationPath, {
        overwrite: true,
      })
      logger.debug({ sourcePath, destinationPath }, 'WebDAV move completed')
      return { success: true }
    } catch (error) {
      logger.error({ err: error, sourcePath, destinationPath }, 'WebDAV move failed')
      throw error
    }
  }

  async check() {
    try {
      // Check if the base URL exists by listing it
      const items = await this.client.getDirectoryContents('/')
      logger.debug({ rootPath: '/', itemCount: items.length }, 'WebDAV check completed')
    } catch (error) {
      logger.error({ err: error, rootPath: '/' }, 'WebDAV check failed')
      throw error
    }
  }
}

export default WebDAVClient
