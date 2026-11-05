/** Fetch only fixed public metadata providers in the browser, without credentials. */
export type MetadataProvider = 'orcid' | 'crossref'

export class ProviderHttpError extends Error {
  constructor(readonly provider: MetadataProvider, readonly status: number) {
    super(`${provider} HTTP ${status}`)
  }
}

export class ProviderResponseError extends Error {}

function providerFor(url: string): MetadataProvider {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) {
    throw new Error('Unexpected metadata provider URL')
  }
  const host = parsed.hostname
  if (host === 'pub.orcid.org') return 'orcid'
  if (host === 'api.crossref.org') return 'crossref'
  throw new Error('Unexpected metadata provider')
}

export async function fetchJSON(url: string, signal: AbortSignal, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const provider = providerFor(url)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 15_000)
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    if (signal.aborted) controller.abort()
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new ProviderHttpError(provider, response.status)
    }
    const length = Number(response.headers.get('content-length'))
    if (length > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Metadata response too large')
    }
    // A missing stream cannot be consumed with a bounded allocation.
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Metadata response has no readable body')
    const chunks: Uint8Array[] = []
    let size = 0
    let finished = false
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          finished = true
          break
        }
        size += value.byteLength
        if (size > maxBytes) throw new Error('Metadata response too large')
        chunks.push(value)
      }
    } finally {
      if (!finished) await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new ProviderResponseError('Invalid metadata JSON response')
    }
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', onAbort)
  }
}
