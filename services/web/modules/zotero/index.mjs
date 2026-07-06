import Settings from '@overleaf/settings'
import ZoteroRouter from './app/src/ZoteroRouter.mjs'

let ZoteroModule = {}

if (Settings.enabledLinkedFileTypes?.includes('zotero')) {
  const { default: ZoteroLinkedFileAgent } = await import(
    './app/src/ZoteroLinkedFileAgent.mjs'
  )

  const siteUrl = Settings.siteUrl.replace(/\/+$/, '') || 'http://localhost'
  Settings.zotero = {
    clientKey: process.env.ZOTERO_CLIENT_KEY,
    clientSecret: process.env.ZOTERO_CLIENT_SECRET,
    callbackURL: `${siteUrl}/user/zotero/oauth/callback`,
  },

  ZoteroModule = {
    router: ZoteroRouter,
    linkedFileAgents: {
      zotero: () => ZoteroLinkedFileAgent,
    },
  }
}

export default ZoteroModule
