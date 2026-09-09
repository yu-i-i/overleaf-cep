let oidcModule = {}
const { default: OIDCModuleManager } = await import('./app/src/OIDCModuleManager.mjs')
const { default: router } = await import('./app/src/OIDCRouter.mjs')
await OIDCModuleManager.initSettings().catch(err => console.warn('oidc initSettings failed:', err.message))
OIDCModuleManager.initPolicy()
oidcModule = {
  name: 'oidc-authentication',
  hooks: {
    passportSetup: OIDCModuleManager.passportSetup,
    getGroupPolicyForUser: OIDCModuleManager.getGroupPolicyForUser,
  },
  router: router,
}

export default oidcModule
