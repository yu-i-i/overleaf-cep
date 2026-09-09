import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

/**
 * Get Overleaf's text extensions configuration
 * @returns {Set<string>} Set of text file extensions (lowercase)
 */
export function getTextExtensions() {
  if (!Settings.textExtensions || !Array.isArray(Settings.textExtensions)) {
    logger.warn('Settings.textExtensions not found, using fallback')
    return new Set(['tex', 'latex', 'sty', 'cls'])
  }

  // Normalize to lowercase for case-insensitive comparison
  return new Set(Settings.textExtensions.map(ext => ext.toLowerCase()))
}

/**
 * Check if a file extension is considered text by Overleaf config
 * @param {string} filepath - File path to check
 * @returns {boolean} True if the file should be treated as text
 */
export function isTextExtension(filepath) {
  const ext = filepath.split('.').pop()?.toLowerCase() || ''
  return getTextExtensions().has(ext)
}

export default { getTextExtensions, isTextExtension }
