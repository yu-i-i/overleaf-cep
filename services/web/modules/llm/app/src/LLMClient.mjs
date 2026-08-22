/*
 * LLMClient - single seam to all LLM providers, built on the Vercel AI SDK.
 *
 * Provider types
 *  - 'openai'           -> @ai-sdk/openai (api.openai.com by default; baseURL optional)
 *  - 'anthropic'        -> @ai-sdk/anthropic (api.anthropic.com by default)
 *  - 'openaiCompatible' -> @ai-sdk/openai-compatible (Ollama, vLLM, llama.cpp,
 *                          academiccloud, OpenRouter, ... any OpenAI-style /v1 server)
 *
 * Everything the controllers need (chat text, structured objects, model
 * listing, token estimation, response cleanup, normalized errors) goes
 * through here so provider wiring exists in exactly one place.
 *
 * Notes
 *  - All call sites pass a normalized `spec` (see normalizeProviderSpec):
 *    { providerType, baseUrl, apiKey, model }
 *  - Reasoning ("thinking") models may spend part of the output budget on
 *    reasoning before producing visible text. Callers should use generous
 *    maxOutputTokens for short tasks; empty text on success is mapped to an
 *    'empty-response' error (assertNonEmpty).
 *  - Token counting: exact tokenizers are not guaranteed for arbitrary
 *    compatible backends, so context sizing uses estimateTokens
 *    (~3.5 chars per token) - conservative enough for budgeting.
 */

import { generateText, generateObject, APICallError, NoContentGeneratedError, NoObjectGeneratedError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const PROVIDER_TYPES = ['openai', 'anthropic', 'openaiCompatible'];

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/*
 * Normalize the different settings shapes (admin file, user provider rows)
 * into one spec object. `settings` may contain providerType or the legacy
 * llmApiType, baseUrl or the legacy llmApiUrl, apiKey or the legacy
 * llmApiKey. `model` is required.
 */
export function normalizeProviderSpec(settings = {}, { model } = {}) {
  const providerType = PROVIDER_TYPES.includes(settings.providerType)
    ? settings.providerType
    : (PROVIDER_TYPES.includes(settings.llmApiType) ? settings.llmApiType : null);
  if (!providerType) {
    throw Object.assign(new Error('Unknown provider type'), { code: 'llm-bad-config' });
  }
  let baseUrl = String(settings.baseUrl || settings.llmApiUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(settings.apiKey || settings.llmApiKey || '').trim();
  if (!model) {
    throw Object.assign(new Error('No model name provided'), { code: 'llm-bad-config' });
  }
  if (providerType === 'anthropic') {
    // The Anthropic SDK appends /v1 to the base URL itself.
    baseUrl = baseUrl.replace(/\/v\d+$/, '');
  }
  return { providerType, baseUrl, apiKey, model: String(model) };
}

/*
 * Detect a provider type from a base URL (presets, legacy migration).
 */
export function detectProviderType(baseUrl) {
  const url = String(baseUrl || '');
  if (url.includes('anthropic.com')) return 'anthropic';
  if (url.includes('openai.com')) return 'openai';
  return 'openaiCompatible';
}

/*
 * Create an AI SDK language model instance.
 */
export function createModel(spec) {
  if (spec.providerType === 'anthropic') {
    const provider = createAnthropic({
      apiKey: spec.apiKey || 'overleaf-local',
      ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {})
    });
    return provider(spec.model);
  }
  if (spec.providerType === 'openai') {
    const provider = createOpenAI({
      apiKey: spec.apiKey || 'overleaf-local',
      ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {})
    });
    return provider(spec.model);
  }
  const provider = createOpenAICompatible({
    name: 'overleaf-llm',
    baseURL: spec.baseUrl,
    ...(spec.apiKey ? { headers: { authorization: `Bearer ${spec.apiKey}` } } : {})
  });
  return provider(spec.model);
}

/*
 * Split messages into (system, coreMessages) for the AI SDK call shape.
 */
function splitMessages(messages, extraSystem) {
  const system = [];
  const rest = [];
  for (const message of messages || []) {
    const content = String(message?.content ?? '');
    if (message?.role === 'system') system.push(content);
    else rest.push({ role: message?.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return {
    system: [extraSystem, ...system].filter(Boolean).join('\n\n') || undefined,
    messages: rest
  };
}

function wrapError(err, modelName) {
  if (err instanceof APICallError) {
    if (err.statusCode === 401 || err.statusCode === 403) {
      return Object.assign(
        new Error('The provider rejected the API key (HTTP 401/403). Check the key and that it has not expired.'),
        { code: 'auth' }
      );
    }
    if (err.statusCode === 404) {
      // overleaf-lab (owner bug report #3): say WHICH model failed and how to
      // fix it — a bare "404" is useless when the provider's catalog changed.
      return Object.assign(
        new Error(
          `Model not found on the backend (404)${modelName ? ` (model: ${modelName})` : ''}. ` +
          'Re-scan the provider model list (Account → LLM settings → Scan) and select an available model.'
        ),
        { code: 'llm-bad-model' }
      );
    }
    if (err.statusCode === 429) {
      return Object.assign(new Error('Rate limited by LLM backend (429)'), { code: 'llm-rate-limited' });
    }
    // WS5 review: do not echo arbitrary backend response bodies to the client
    // (possible internal hostname/fragment leakage); status + code is enough.
    // The 401/403 branch above intentionally keeps a generic key-rejection hint.
    return Object.assign(
      // overleaf-lab (owner bug report #3): 5xx from the backend (e.g. Ollama
      // overloads) — include the model so the failure is diagnosable.
      new Error(
        `LLM backend error (HTTP ${err.statusCode})${modelName ? ` for model: ${modelName}` : ''}. ` +
        'This is usually transient provider overload — retry, or select a different model.'
      ),
      { code: 'llm-error' }
    );
  }
  if (err instanceof NoContentGeneratedError || err instanceof NoObjectGeneratedError) {
    return Object.assign(new Error(err.message || 'Empty response'), { code: 'empty-response' });
  }
  if (err && /abort/i.test(String(err.name || err.message || ''))) {
    return Object.assign(new Error('Request aborted'), { code: 'llm-abort' });
  }
  if (err && err.code) return err;
  const base = err?.message ? `LLM request failed: ${err.message}` : 'LLM request failed';
  const suffix = modelName ? ` (model: ${modelName})` : '';
  return Object.assign(new Error(base + suffix), { code: 'llm-error' });
}

/*
 * Remove stray chain-of-thought markers from visible text (some servers,
 * e.g. Ollama with Qwen3, leak thinking into `content`).
 */
export function stripThinkTags(text) {
  return String(text || '').replace(/<\/?think[^>]*>/gi, '');
}

function usageOf(result) {
  const u = result?.usage;
  if (!u) return null;
  return {
    inputTokens: u.inputTokens ?? null,
    outputTokens: u.outputTokens ?? null,
    totalTokens: u.totalTokens ?? null
  };
}

function commonCallOptions(options, { defaultMaxRetries = 1 } = {}) {
  return {
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: options.maxRetries ?? defaultMaxRetries,
    abortSignal: options.signal,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    providerOptions: options.providerOptions
  };
}

/*
 * Plain text chat/completion.
 * Returns { text, usage, finishReason }
 */
export async function chatText(spec, messages, options = {}) {
  const { system, messages: coreMessages } = splitMessages(messages, options.system);
  try {
    const result = await generateText({
      model: createModel(spec),
      system,
      messages: coreMessages,
      headers: { 'user-agent': 'overleaf-llm-module' },
      ...commonCallOptions(options)
    });
    return { text: stripThinkTags(result.text), usage: usageOf(result), finishReason: result.finishReason };
  }
  catch (err) {
    throw wrapError(err, spec.model);
  }
}

/*
 * Structured object generation (compliance reviews).
 * Returns { object, usage }
 */
export async function chatObject(spec, messages, schema, options = {}) {
  const { system, messages: coreMessages } = splitMessages(messages, options.system);
  try {
    const result = await generateObject({
      model: createModel(spec),
      schema,
      system,
      messages: coreMessages,
      ...commonCallOptions(options, { defaultMaxRetries: 0 })
    });
    return { object: result.object, usage: usageOf(result) };
  }
  catch (err) {
    throw wrapError(err, spec.model);
  }
}

/*
 * List models via the standard endpoint. Both OpenAI-style servers
 * (Ollama, vLLM, llama.cpp, most gateways) and Anthropic expose them.
 */
export async function listModels(spec, { timeoutMs = 60000 } = {}) {
  const defaultBase = spec.providerType === 'anthropic'
    ? 'https://api.anthropic.com'
    : 'https://api.openai.com/v1';
  const base = (spec.baseUrl || defaultBase).replace(/\/+$/, '');
  const isAnthropic = spec.providerType === 'anthropic';
  const url = `${isAnthropic ? base + '/v1' : base}/models`;
  const headers = { accept: 'application/json', 'user-agent': 'overleaf-llm-module' };
  if (isAnthropic) {
    headers['x-api-key'] = spec.apiKey || 'overleaf-local';
    headers['anthropic-version'] = '2023-06-01';
  }
  else if (spec.apiKey) headers.authorization = `Bearer ${spec.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  }
  catch (err) {
    const message = /abort/i.test(String(err?.name || ''))
      ? `Timed out listing models at ${url}`
      : `Could not reach ${url} (${err?.message || 'network error'})`;
    throw Object.assign(new Error(message), { code: /abort/i.test(String(err?.name || '')) ? 'llm-timeout' : 'llm-error' });
  }
  finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 120);
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(
        new Error(`The provider rejected the API key (HTTP ${response.status})${body ? ` — ${body}` : ''}`),
        { code: 'auth', status: response.status }
      );
    }
    const code = response.status === 404 ? 'llm-bad-model' : 'llm-error';
    throw Object.assign(new Error(`Backend returned ${response.status}${body ? `: ${body}` : ''}`), { code, status: response.status });
  }
  const data = await response.json();
  const ids = (data?.data || data?.models || [])
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name))
    .filter(Boolean)
    .sort();
  return { ids, raw: data };
}

/*
 * Conservative token estimate (~3.5 chars/token) for context budgeting.
 */
export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 3.5));
}

/*
 * Reasoning models can return 200 with all budget spent on thinking.
 * Surface that as a clear error instead of an empty result.
 */
export function assertNonEmpty(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw Object.assign(
      new Error('The model returned no visible text. Reasoning models may spend the whole output budget on thinking - raise the output budget or disable reasoning for this task.'),
      { code: 'empty-response' }
    );
  }
  return trimmed;
}

export default {
  PROVIDER_TYPES,
  normalizeProviderSpec,
  detectProviderType,
  createModel,
  chatText,
  chatObject,
  listModels,
  estimateTokens,
  stripThinkTags,
  assertNonEmpty
};
