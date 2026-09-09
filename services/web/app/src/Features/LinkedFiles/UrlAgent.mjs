import logger from '@overleaf/logger'
import urlValidator from 'valid-url'
import fetch from 'node-fetch'
import LinkedFilesErrors from './LinkedFilesErrors.mjs'
import LinkedFilesHandler from './LinkedFilesHandler.mjs'
import UrlHelper from '../Helpers/UrlHelper.mjs'
import UrlPolicy from './UrlPolicy.mjs'
import { getSection } from '../SiteSettings/SiteSettingsManager.mjs'
import { RequestFailedError } from '@overleaf/fetch-utils'
import { callbackify } from '@overleaf/promise-utils'
import { FileTooLargeError } from '../Errors/Errors.js'

const { InvalidUrlError, UrlFetchFailedError } = LinkedFilesErrors

async function createLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {
  logger.info(
    { projectId, userId, url: linkedFileData.url },
    'create linked file'
  )
  linkedFileData = _sanitizeData(linkedFileData)
  const fetchUrl = _getUrl(projectId, linkedFileData, userId)

  // 3d (2026-08-28): SSRF / admin allowlist guard — the externalUrl site
  // settings (allowedResourcesRegex + blockedNetworks) apply to the
  // TARGET url and to every redirect hop.
  let policy
  try {
    policy = await getSection('externalUrl')
  } catch (err) {
    logger.warn(
      { err, projectId, userId, url: linkedFileData.url },
      'url policy check unavailable; using defaults'
    )
    policy = { allowedResourcesRegex: '', blockedNetworks: [] }
  }
  await UrlPolicy.assertUrlAllowed(linkedFileData.url, policy)

  try {
    const readStream = await fetchWithPolicyRedirects(fetchUrl, policy)
    const file = await LinkedFilesHandler.promises.importFromStream(
      projectId,
      readStream,
      linkedFileData,
      name,
      parentFolderId,
      userId
    )
    return file._id
  } catch (error) {
    // A site-policy 403 is a deliberate rejection — surface it as-is so the
    // client receives a 403 rather than a wrapped 422 "fetch failed".
    if (error instanceof LinkedFilesErrors.UrlPolicyDeniedError) {
      throw error
    }
    if (error instanceof RequestFailedError && /too large/.test(error.body)) {
      throw new FileTooLargeError('file too large', {
        url: linkedFileData.url,
      }).withCause(error)
    }
    throw new UrlFetchFailedError('url fetch failed', {
      url: linkedFileData.url,
    }).withCause(error)
  }
}

async function refreshLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {
  return await createLinkedFile(
    projectId,
    linkedFileData,
    name,
    parentFolderId,
    userId
  )
}

function _sanitizeData(data) {
  return {
    provider: data.provider,
    url: UrlHelper.prependHttpIfNeeded(data.url),
    importedAt: data.importedAt,
  }
}

const MAX_REDIRECT_HOPS = 5
const FETCH_TIMEOUT_MS = 60 * 1000

/**
 * 3d: fetch with manual redirect handling so each hop is re-checked
 * against the site policy (a 302 to 10.0.0.1 must not bypass the guard).
 */
async function fetchWithPolicyRedirects(url, policy, hops = 0) {
  if (hops > MAX_REDIRECT_HOPS) {
    throw new RequestFailedError(url, {}, { status: 302 }, 'too many redirects')
  }
  // 2026-08-31: belt & braces — callers (linked files, bundle import)
  // already assert the first URL, but the agent must be safe even when
  // used standalone: never fetch a URL whose host the site policy
  // blocks.
  await UrlPolicy.assertUrlAllowed(url, policy)
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const status = response.status
  if (status >= 300 && status < 400) {
    const location = response.headers.get('location')
    if (!location) {
      const body = await response.text().catch(() => '')
      throw new RequestFailedError(url, {}, response, body)
    }
    const body = response.body
    if (body) body.destroy()
    const nextUrl = new URL(location, url).toString()
    await UrlPolicy.assertUrlAllowed(nextUrl, policy)
    return fetchWithPolicyRedirects(nextUrl, policy, hops + 1)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new RequestFailedError(url, {}, response, body)
  }
  return response.body
}

function _getUrl(projectId, data, currentUserId) {
  let { url } = data
  if (!urlValidator.isWebUri(url)) {
    throw new InvalidUrlError(`invalid url: ${url}`)
  }
  url = UrlHelper.wrapUrlWithProxy(url)
  return url
}

export default {
  createLinkedFile: callbackify(createLinkedFile),
  refreshLinkedFile: callbackify(refreshLinkedFile),
  // 2026-08-31 (R12-15): fetchWithPolicyRedirects was implemented (and used
  // internally by createLinkedFile) but never exposed — the template-bundle
  // "Import from URL" flow calls UrlAgent.default.fetchWithPolicyRedirects
  // and 500'd with "is not a function". Expose it on the default object,
  // the promises namespace, and as a named export.
  fetchWithPolicyRedirects: (url, policy, hops = 0) =>
    fetchWithPolicyRedirects(url, policy, hops),
  promises: { createLinkedFile, refreshLinkedFile, fetchWithPolicyRedirects },
}

export { fetchWithPolicyRedirects }
