import { isOIDCEnabled } from '../ssoConfigLoader.mjs'

let oidcModule = {}
const oidcEnabled = process.env.EXTERNAL_AUTH?.includes('oidc') || await isOIDCEnabled()
if (oidcEnabled) {
  const { default: OIDCModuleManager } = await import('./app/src/OIDCModuleManager.mjs')
  const { default: router } = await import('./app/src/OIDCRouter.mjs')
  await OIDCModuleManager.initSettings()
  OIDCModuleManager.initPolicy()
  oidcModule = {
    name: 'oidc-authentication',
    hooks: {
      passportSetup: OIDCModuleManager.passportSetup,
      getGroupPolicyForUser: OIDCModuleManager.getGroupPolicyForUser,
    },
    router: router,
  }
}
export default oidcModule
