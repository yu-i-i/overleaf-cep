/**
 * Generate Authorization header value from username/password (Basic Auth)
 */
export function generateBasicAuthHeader(username, password) {
  const credentials = `${username}:${password}`
  return `Basic ${Buffer.from(credentials).toString('base64')}`
}

/**
 * Validate authentication credentials are non-empty
 */
export function validateAuth(auth) {
  if (!auth || !auth.username || !auth.password) {
    throw new Error('Missing authentication credentials')
  }
  return true
}

/**
 * Clean URL for logging (remove any embedded credentials)
 */
export function sanitizeUrlForLogging(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return url
  }
}
