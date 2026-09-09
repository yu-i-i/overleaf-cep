import BaseProvider from './BaseProvider.mjs'
import OError from '@overleaf/o-error'

// Helper function to remove <think> tags (for DeepSeek, Qwen and similar models)
// Handles both closed <think>...</think> and unclosed <think>... at end of string
function stripThinkTags(content) {
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, '')
    return cleaned.trim()
}

export default class OpenAIProvider extends BaseProvider {
  headers() {
    const headers = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    return headers
  }

  async listModels() {
    return this.fetch('/models')
  }

  async checkConnection(model, timeoutMs) {
    if (!model) {
      throw new OError('No LLM model configured for the connection test', { status: 400 })
    }

    return this.chat(
      {
        model,
        messages: [
          {
            role: 'user',
            content: 'Test connection',
          },
        ],
        max_tokens: 1,
      },
      timeoutMs
    )
  }

  async chat(body, timeoutMs) {
    const data = await this.fetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs,
    })

    if (!data?.choices?.[0]?.message) {
      throw new Error('Invalid OpenAI compatible provider chat response')
    }

    data.choices[0].message.content = this.extractText(data)

    return data
  }

  async complete(body) {
    // overleaf-lab: the await is required — without it this returned an
    // extracted-text of a Promise (always '') and killed inline completion.
    const data = await this.fetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    return this.extractText(data)
  }

  // overleaf-lab: full normalized chat response: the stripped content, the finish
  // reason (truncation detection) and the raw body (llama.cpp `timings` etc.).
  async chatDetailed(body, opts = {}) {
    const { signal } = opts
    const data = await this.fetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    })

    if (!data?.choices?.[0]?.message) {
      throw new Error('Invalid OpenAI compatible provider chat response')
    }

    const choice = data.choices[0]

    return {
      content: this.extractText(data),
      finishReason: choice.finish_reason || null,
      raw: data,
    }
  }

  // overleaf-lab: exact token count via the llama.cpp /tokenize extension; null
  // on any failure so callers fall back to the heuristic estimate.
  async tokenize(text) {
    try {
      const data = await this.fetch('/tokenize', {
        method: 'POST',
        body: JSON.stringify({ content: text }),
      })

      return Array.isArray(data?.tokens) ? data.tokens.length : null
    } catch {
      return null
    }
  }
  
  extractText(data) {
    return stripThinkTags(
      data?.choices?.[0]?.message?.content?.trim() || ''
    )
  }
}
