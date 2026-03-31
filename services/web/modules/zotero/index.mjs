import Settings from '@overleaf/settings'

const { default: ZoteroRouter } = await import('./app/src/ZoteroRouter.mjs')

const ZoteroModule = {
  router: ZoteroRouter,
}

if (Settings.enabledLinkedFileTypes?.includes('zotero')) {
  const { default: ZoteroLinkedFileAgent } = await import(
    './app/src/ZoteroLinkedFileAgent.mjs'
  )
  ZoteroModule.linkedFileAgents = {
    zotero: () => ZoteroLinkedFileAgent,
  }
}

export default ZoteroModule
