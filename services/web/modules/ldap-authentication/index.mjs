import initLdapSettings from './app/src/InitLdapSettings.mjs'
import addLdapStrategy from './app/src/LdapStrategy.mjs'
import fetchLdapContacts from './app/src/LdapContacts.mjs'

let ldapModule = {};
if (process.env.EXTERNAL_AUTH === 'ldap') {
  initLdapSettings()
  ldapModule = {
    name: 'ldap-authentication',
    hooks: {
      passportSetup: function (passport, callback) {
        try {
          addLdapStrategy(passport)
          callback(null)
        } catch (error) {
          callback(error)
        }
      },
      getContacts: async function (userId, contacts, callback) {
        try {
          const newLdapContacts = await fetchLdapContacts(userId, contacts)
          callback(null, newLdapContacts)
        } catch (error) {
          callback(error)
        }
      },
    }
  }
}
export default ldapModule
