const Settings = require('@overleaf/settings')
const ldapjs = require('ldapauth-fork/node_modules/ldapjs')
const { splitFullName } = require('../../../../app/src/Features/Authentication/AuthenticationManagerLdap')

async function fetchLdapContacts(contacts) {
  if (!Settings.ldap?.enable || !process.env.OVERLEAF_LDAP_CONTACT_FILTER) { return [] }

  const attEmail = Settings.ldap.attEmail
  const attFirstName = Settings.ldap?.attFirstName || ""
  const attLastName = Settings.ldap?.attLastName || ""
  const attName = Settings.ldap?.attName || ""

  const ldapConfig = {
    url: Settings.ldap.server.url,
  }

  const searchOptions = {
    scope: Settings.ldap.server.searchScope || 'sub',
    attributes: [attEmail, attFirstName, attLastName, attName],
    filter: process.env.OVERLEAF_LDAP_CONTACT_FILTER,
  }

  const bindDN = Settings.ldap.server.bindDN || ""
  const bindCredentials = Settings.ldap.server.bindCredentials || ""
  const searchBase = Settings.ldap.server.searchBase

  const client = ldapjs.createClient(ldapConfig)

  let ldapUsers
  try {
    await _bindLdap(client, bindDN, bindCredentials)
    ldapUsers = await _searchLdap(client, searchBase, searchOptions)
  } catch (error) {
      console.error('Error: ', error)
      return []
  } finally {
      client.unbind()
  }

  const newLdapContacts = []
  ldapUsers.forEach(ldapUser => {
    if (!contacts.some(contact => contact.email == ldapUser[attEmail].toLowerCase())) {
      let nameParts = ["",""]
      if ((!attFirstName || !attLastName) && attName) {
        nameParts = splitFullName(ldapUser[attName])
      }
      const firstName = attFirstName ? ldapUser[attFirstName] : nameParts[0]
      const lastName  = attLastName  ? ldapUser[attLastName]  : nameParts[1]
      newLdapContacts.push(
        {
          first_name: firstName,
          last_name: lastName,
          email: ldapUser[attEmail].toLowerCase(),
          type: 'user',
        }
      )
    }
  })
  return newLdapContacts.sort((a, b) => a.last_name.localeCompare(b.last_name)
                                     || a.first_name.localeCompare(b.first_name)
                                     || a.email.localeCompare(b.email)
                             )
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
