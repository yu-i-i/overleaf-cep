import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

logger.debug({}, 'Enable Draw.io module')

// Add .drawio and .drawio.xml to text extensions so they are stored as docs
if (!Settings.textExtensions.includes('drawio')) {
  Settings.textExtensions.push('drawio')
}

// Allow embedding Draw.io in an iframe
if (Settings.csp && Settings.csp.viewDirectives) {
  const ideView = 'app/views/project/ide-react'
  const existing = Settings.csp.viewDirectives[ideView] || []
  Settings.csp.viewDirectives[ideView] = [
    ...existing,
    "frame-src 'self' https://embed.diagrams.net",
  ]
}

const DrawioModule = {}
export default DrawioModule
