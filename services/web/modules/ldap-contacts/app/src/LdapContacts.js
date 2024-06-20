const settings = require('@overleaf/settings')
const ldapjs = require('ldapauth-fork/node_modules/ldapjs')

async function fetchLdapContacts(contacts) {
  if (!process.env.OVERLEAF_LDAP_CONTACT_FILTER) { return [] }

  const email = settings.ldap.attEmail
  const firstName = settings.ldap.attFirstName
  const lastName = settings.ldap.attLastName

  const ldapConfig = {
    url: settings.ldap.server.url,
  }

  const searchOptions = {
    scope: settings.ldap.server.searchScope,
    attributes: [email, firstName, lastName],
    filter: process.env.OVERLEAF_LDAP_CONTACT_FILTER,
  }
  const bindDN = settings.ldap.server.bindDN
  const bindCredentials = settings.ldap.server.bindCredentials
  const ldap_base = settings.ldap.server.searchBase

  const client = ldapjs.createClient(ldapConfig)

  let searchEntries
  try {
    await _bindLdap(client, bindDN, bindCredentials)
    searchEntries = await _searchLdap(client, ldap_base, searchOptions)
  } catch (error) {
      console.error('Error: ', error)
      return []
  } finally {
      client.unbind()
  }

  searchEntries.sort((a, b) => a[lastName].localeCompare(b[lastName]))

  const newLdapContacts = []
  searchEntries.forEach(entry => {
    if (!contacts.some(contact => contact.email == entry[email].toLowerCase())) {
      newLdapContacts.push(
        {
          first_name: entry[firstName],
          last_name: entry[lastName],
          email: entry[email].toLowerCase(),
          type: 'user',
        }
      )
    }
  })
  return newLdapContacts
}

const _bindLdap = (client, bindDN, bindCredentials) => {
  return new Promise((resolve, reject) => {
    client.bind(bindDN, bindCredentials, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}
const _searchLdap = (client, baseDN, options) => {
  return new Promise((resolve, reject) => {
    const searchEntries = []
    client.search(baseDN, options, (err, res) => {
      if (err) {
        reject(err)
      } else {
        res.on('searchEntry', (entry) => {
          searchEntries.push(entry.object)
        })
        res.on('error', (err) => {
          reject(err)
        })
        res.on('end', () => {
          resolve(searchEntries)
        })
      }
    })
  })
}
module.exports = { fetchLdapContacts }
