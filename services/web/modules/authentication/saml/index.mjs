let samlModule = {}
const { default: SAMLModuleManager } = await import('./app/src/SAMLModuleManager.mjs')
const { default: router } = await import('./app/src/SAMLRouter.mjs')
const { default: nonCsrfRouter } = await import('./app/src/SAMLNonCsrfRouter.mjs')
await SAMLModuleManager.initSettings().catch(err => console.warn('saml initSettings failed:', err.message))
SAMLModuleManager.initPolicy()
samlModule = {
  name: 'saml-authentication',
  hooks: {
    passportSetup: SAMLModuleManager.passportSetup,
    getGroupPolicyForUser: SAMLModuleManager.getGroupPolicyForUser,
  },
  router: router,
  nonCsrfRouter: nonCsrfRouter,
}

export default samlModule
