import logger from '@overleaf/logger'
import fetch from 'node-fetch'

const LANGUAGETOOL_URL = process.env.LANGUAGETOOL_URL || ''
const LANGUAGETOOL_ENABLED =
  process.env.LANGUAGETOOL_ENABLED === 'true' && LANGUAGETOOL_URL !== ''

const MAX_TEXT_SIZE = 100_000 // 100 KB limit for safety

const LanguageToolController = {
  /**
   * GET /languagetool/status
   * Returns whether LanguageTool is enabled (no auth required for feature detection)
   */
  async getStatus(req, res) {
    res.json({ enabled: LANGUAGETOOL_ENABLED })
  },

  /**
   * GET /languagetool/languages
   * Returns the list of supported languages from the LT service
   */
  async getLanguages(req, res, next) {
    if (!LANGUAGETOOL_ENABLED) {
      return res.status(404).json({ error: 'LanguageTool is not enabled' })
    }

    try {
      const response = await fetch(`${LANGUAGETOOL_URL}/v2/languages`, {
        headers: { Accept: 'application/json' },
        timeout: 5000,
      })

      if (!response.ok) {
        logger.error(
          { status: response.status },
          'LanguageTool languages request failed'
        )
        return res.status(502).json({ error: 'LanguageTool request failed' })
      }

      const data = await response.json()
      res.json(data)
    } catch (err) {
      logger.error({ err }, 'Error fetching LanguageTool languages')
      next(err)
    }
  },

  /**
   * POST /languagetool/check
   * Proxies text/annotation data to the LanguageTool service and returns matches.
   * Accepts JSON body: { language, text?, data? }
   */
  async check(req, res, next) {
    if (!LANGUAGETOOL_ENABLED) {
      return res.json({ matches: [] })
    }

    const { language = 'auto', text, data } = req.body

    if (!text && !data) {
      return res.status(400).json({ error: 'text or data is required' })
    }

    // Sanitize: reject oversized requests
    const contentStr =
      typeof data === 'string'
        ? data
        : typeof data === 'object'
          ? JSON.stringify(data)
          : text || ''

    if (contentStr.length > MAX_TEXT_SIZE) {
      logger.warn(
        { size: contentStr.length },
        'LanguageTool request exceeds size limit, truncating'
      )
    }

    try {
      const params = new URLSearchParams()
      params.set('language', language)

      if (data) {
        const dataStr =
          typeof data === 'string' ? data : JSON.stringify(data)
        params.set('data', dataStr.slice(0, MAX_TEXT_SIZE))
      } else {
        params.set('text', (text || '').slice(0, MAX_TEXT_SIZE))
      }

      // Disable rules that produce excessive false positives in LaTeX documents
      params.set(
        'disabledRules',
        'WHITESPACE_RULE,COMMA_PARENTHESIS_WHITESPACE,CONSECUTIVE_SPACES,DASH_RULE,UPPERCASE_SENTENCE_START'
      )

      const response = await fetch(`${LANGUAGETOOL_URL}/v2/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
        timeout: 60_000,
      })

      if (!response.ok) {
        const body = await response.text()
        logger.error(
          { status: response.status, body },
          'LanguageTool check failed'
        )
        return res.json({ matches: [] })
      }

      const result = await response.json()
      res.json(result)
    } catch (err) {
      // On timeout or network error return empty results so the linter stays silent
      if (err.type === 'request-timeout' || err.name === 'FetchError') {
        logger.warn({ err }, 'LanguageTool check timed out or failed, returning empty results')
        return res.json({ matches: [] })
      }
      logger.error({ err }, 'Error checking text with LanguageTool')
      next(err)
    }
  },
}

export default LanguageToolController
