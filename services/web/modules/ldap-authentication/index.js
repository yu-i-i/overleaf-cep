const { initLdapAuthentication } = require('./app/src/InitLdapAuthentication')
const { fetchLdapContacts } = require('./app/src/LdapContacts')
const { addLdapStrategy } = require('./app/src/LdapStrategy')

initLdapAuthentication()

module.exports = {
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
