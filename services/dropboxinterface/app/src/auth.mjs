/**
 * Dropbox authentication helpers
 *
 * Validates access tokens and provides utilities for token extraction.
 */

/**
 * Validate Dropbox access token format (basic check)
 */
export function validateToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing or invalid access token')
  }

  // Dropbox tokens start with 'sl.' for standard tokens
  if (!token.startsWith('sl.')) {
    console.warn(
      'Dropbox access token does not appear to be a valid sl. token'
    )
  }

  return true
}

/**
 * Sanitize token for logging (hide full token)
 */
export function sanitizeTokenForLogging(token) {
  if (!token || typeof token !== 'string') return '[none]'
  // Show only first 10 and last 4 characters
  if (token.length <= 14) return '[hidden]'
  return `${token.substring(0, 10)}...${token.substring(token.length - 4)}`
}

/**
 * Extract access token from request headers/body
 */
export function extractAccessToken(req, res, next) {
  // Check Authorization header: Bearer <token>
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    req.dropboxToken = req.headers.authorization.split(' ')[1]
  }
  // Check X-Access-Token header
  else if (req.headers['x-access-token']) {
    req.dropboxToken = req.headers['x-access-token']
  }
  // Check body
  else if (req.body?.access_token) {
    req.dropboxToken = req.body.access_token
  }
  // Check query parameter (less secure, but supported for debugging)
  else if (req.query?.access_token) {
    console.warn('Using access token in query string - not recommended')
    req.dropboxToken = req.query.access_token
  }

  next()
}

export default {
  validateToken,
  sanitizeTokenForLogging,
  extractAccessToken
}
