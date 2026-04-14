import { isSAMLEnabled } from '../ssoConfigLoader.mjs'

let samlModule = {}
const samlEnabled = process.env.EXTERNAL_AUTH?.includes('saml') || await isSAMLEnabled()
if (samlEnabled) {
  const { default: SAMLModuleManager } = await import('./app/src/SAMLModuleManager.mjs')
  const { default: router } = await import('./app/src/SAMLRouter.mjs')
  const { default: nonCsrfRouter } = await import('./app/src/SAMLNonCsrfRouter.mjs')
  await SAMLModuleManager.initSettings()
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
}
export default samlModule
