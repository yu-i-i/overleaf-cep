import OpenAIProvider from './providers/OpenAIProvider.mjs'
import AnthropicProvider from './providers/AnthropicProvider.mjs'

// overleaf-lab: resolve the provider API type. An explicit setting (admin
// settings file, LLM_API_TYPE env, or the `llmProvider` legacy key) always
// wins. Otherwise infer from the API URL or key shape: Anthropic has its own
// API, everything else (OpenAI, Ollama, llama.cpp, OpenAI-compatible
// gateways) uses the OpenAI-compatible shape.
export function detectApiType(settings = {}) {
  const explicit = settings.llmApiType || settings.llmProvider
  if (explicit) {
    return explicit
  }

  const url = String(settings.llmApiUrl || process.env.LLM_API_URL || '')
  const key = String(settings.llmApiKey || process.env.LLM_API_KEY || '')

  if (/anthropic\.com/i.test(url) || key.trim().startsWith('sk-ant-')) {
    return 'anthropic'
  }

  return 'openai'
}

export function createLLMProvider(settings = {}) {
  if (detectApiType(settings) === 'anthropic') {
    return new AnthropicProvider(settings)
  }

  return new OpenAIProvider(settings)
}
