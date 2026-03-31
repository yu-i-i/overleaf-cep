import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { expressify } from '@overleaf/promise-utils'
import { fetchBibtexFromDoi, sanitizeDoi } from './DoiService.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init doi-picker router')

    webRouter.get(
      '/doi-picker/fetch',
      AuthenticationController.requireLogin(),
      expressify(async (req, res) => {
        const raw = req.query.doi
        if (!raw || typeof raw !== 'string') {
          return res.status(400).json({ error: 'doi query parameter required' })
        }

        const doi = sanitizeDoi(raw)
        if (!doi) {
          return res.status(400).json({ error: 'Invalid DOI' })
        }

        try {
          const bibtex = await fetchBibtexFromDoi(doi)
          res.json({ bibtex })
        } catch (err) {
          logger.warn({ err, doi }, 'Failed to fetch DOI')
          res.status(502).json({ error: err?.message || 'Failed to fetch DOI' })
        }
      })
    )
  },
}
