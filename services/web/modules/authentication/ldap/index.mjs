let ldapModule = {}
if (process.env.EXTERNAL_AUTH?.includes('ldap')) {
  const { default: LDAPModuleManager } = await import('./app/src/LDAPModuleManager.mjs')
  const { default: router } = await import('./app/src/LDAPRouter.mjs')
  LDAPModuleManager.initSettings()
  LDAPModuleManager.initPolicy()
  ldapModule = {
    name: 'ldap-authentication',
    hooks: {
      passportSetup: LDAPModuleManager.passportSetup,
      getGroupPolicyForUser: LDAPModuleManager.getGroupPolicyForUser,
      promises: {
        getContacts: LDAPModuleManager.getContacts,
      },
    },
    router: router,
  }
}
export default ldapModule
