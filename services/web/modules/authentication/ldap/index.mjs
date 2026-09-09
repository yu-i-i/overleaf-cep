let ldapModule = {}
const { default: LDAPModuleManager } = await import('./app/src/LDAPModuleManager.mjs')
const { default: router } = await import('./app/src/LDAPRouter.mjs')
await LDAPModuleManager.initSettings().catch(err => console.warn('ldap initSettings failed:', err.message))
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

export default ldapModule
