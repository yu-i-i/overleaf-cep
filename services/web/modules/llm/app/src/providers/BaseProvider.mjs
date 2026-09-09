import { fetchJson, RequestFailedError } from '@overleaf/fetch-utils'
import OError from '@overleaf/o-error'

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000

function handleError(err) {
  if (err.name === 'AbortError') {
    throw new OError('LLM request timed out', { timeout: REQUEST_TIMEOUT_MS / 1000, status: 504 }).withCause(err)
  }
  const status = err.response?.status || 500

  if (!(err instanceof RequestFailedError)) {
    throw new OError('Something wrong with LLM request', { status }).withCause(err)
  }

  let errInfo
  try {
    errInfo = JSON.parse(err.body)
  } catch {
    errInfo = { message: err.body }
  }

  throw new OError('LLM request failed', errInfo).withCause(err)
}

export default class BaseProvider {
  constructor({ llmApiUrl, llmApiKey }) {
    this.apiUrl = llmApiUrl.replace(/\/+$/, '')
    this.apiKey = llmApiKey || ''
  }

  async listModels() {
    throw new Error('Not implemented')
  }

  async checkConnection(model) {
    throw new Error('Not implemented')
  }

  async chat(body) {
    throw new Error('Not implemented')
  }

  async complete(body) {
    throw new Error('Not implemented')
  }

  // overleaf-lab: PR item 4 — detailed chat for consumers that need the full
  // normalized response (finish reason, raw timings) in addition to the text.
  async chatDetailed() {
    throw new Error('Not implemented')
  }

  // overleaf-lab: exact prompt token count via the backend's /tokenize extension.
  // Providers without it (e.g. Anthropic) inherit this null default and the
  // caller falls back to a heuristic estimate.
  async tokenize() {
    return null
  }

  async fetch(path, options = {}) {
    // overleaf-lab: optional per-call timeout (used by interactive
    // "check connection" flows); defaults to the 5-minute request timeout.
    // An explicit AbortSignal (job cancel) wins when provided.
    const { timeoutMs, signal, ...rest } = options
    return await fetchJson(`${this.apiUrl}${path}`, {
      ...rest,
      headers: {
        ...this.headers(),
        ...(options.headers || {}),
      },
      signal: signal || AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS),
    }).catch(err => { handleError(err) })
  }

  normalizeChatResponse(data) {
    return data
  }

  headers() {
    return {}
  }
}
