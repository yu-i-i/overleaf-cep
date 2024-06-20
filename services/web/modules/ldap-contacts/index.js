const { fetchLdapContacts } = require('./app/src/LdapContacts')

module.exports = {
  name: 'ldap-contacts',
  hooks: {
    getContacts: async function (userId, contacts, callback) {
      try {
        const newLdapContacts = await fetchLdapContacts(contacts)
        callback(null, newLdapContacts)
      } catch (error) {
        callback(error)
      }
    }
  }
};
