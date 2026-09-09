import BaseProvider from './BaseProvider.mjs'
import OError from '@overleaf/o-error'

// Helper function to remove <think> tags (for DeepSeek, Qwen and similar models)
// Handles both closed <think>...</think> and unclosed <think>... at end of string
function stripThinkTags(content) {
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    cleaned = cleaned.replace(/<think>[\s\S]*/gi, '')
    return cleaned.trim()
}

export default class AnthropicProvider extends BaseProvider {
  headers() {
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey
    }

    return headers
  }

  async listModels() {
    return this.fetch('/v1/models')
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
    const data = await this.fetch('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(this.buildRequest(body)),
      timeoutMs,
    })

    return {
      id: data.id,
      model: data.model,
      usage: data.usage,
      choices: [
        {
          index: 0,
          finish_reason: data.stop_reason,
          message: {
            role: 'assistant',
            content: this.extractText(data),
          },
        },
      ],
    }
  }

  async complete(body, timeoutMs) {
    const data = await this.fetch('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(this.buildRequest(body)),
      timeoutMs,
    })

    return this.extractText(data)
  }

  // overleaf-lab: full response in the shared detailed shape. Anthropic has no
  // OpenAI-style response_format (structured output API) nor timings; the
  // reviewer's lenient JSON extraction (fences/parse-with-retry) carries that role
  // instead, and the prompt already constrains the JSON shape.
  async chatDetailed(body, opts = {}) {
    const { signal } = opts
    const cleanBody = { ...body }
    delete cleanBody.response_format

    const data = await this.fetch('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(this.buildRequest(cleanBody)),
      signal,
    })

    return {
      content: this.extractText(data),
      finishReason: data?.stop_reason || null,
      raw: data,
    }
  }

  buildRequest(body) {
    const { messages = [], ...rest } = body

    // overleaf-lab: response_format is OpenAI-specific — never forward it to the
    // Anthropic API (unknown fields risk a 400 or silent misparse).
    delete rest.response_format

    const system = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n')

    const request = {
      ...rest,
      messages: messages.filter(m => m.role !== 'system'),
    }

    if (system) {
      request.system = system
    }

    return request
  }

  extractText(data) {
    return stripThinkTags(
      (data.content || [])
        .filter(x => x.type === 'text')
        .map(x => x.text)
        .join('')
        .trim()
    )
  }
}
