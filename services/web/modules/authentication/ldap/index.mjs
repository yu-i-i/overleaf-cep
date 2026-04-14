import { isLDAPEnabled } from '../ssoConfigLoader.mjs'

let ldapModule = {}
const ldapEnabled = process.env.EXTERNAL_AUTH?.includes('ldap') || await isLDAPEnabled()
if (ldapEnabled) {
  const { default: LDAPModuleManager } = await import('./app/src/LDAPModuleManager.mjs')
  const { default: router } = await import('./app/src/LDAPRouter.mjs')
  await LDAPModuleManager.initSettings()
  LDAPModuleManager.initPolicy()
  ldapModule = {
    name: 'ldap-authentication',
    hooks: {
      passportSetup: LDAPModuleManager.passportSetup,
      getContacts: LDAPModuleManager.getContacts,
      getGroupPolicyForUser: LDAPModuleManager.getGroupPolicyForUser,
    },
    router: router,
  }
}
export default ldapModule
