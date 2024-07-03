const { fetchLdapContacts } = require('./app/src/LdapContacts')
const { addLdapStrategy } = require('./app/src/LdapStrategy')

module.exports = {
  name: 'ldap-authentication',
  hooks: {
    passportSetup: async function (passport, callback) {
      try {
        addLdapStrategy(passport)
        callback(null)
      } catch (error) {
        callback(error)
      }
    },
    getContacts: async function (userId, contacts, callback) {
      try {
        const newLdapContacts = await fetchLdapContacts(contacts)
        callback(null, newLdapContacts)
      } catch (error) {
        callback(error)
      }
    },
  }
}
