const Settings = require('@overleaf/settings')
const ldapjs = require('ldapauth-fork/node_modules/ldapjs')
const { splitFullName } = require('./AuthenticationManagerLdap')
const UserGetter = require('../../../../app/src/Features/User/UserGetter')

async function fetchLdapContacts(userId, contacts) {
  if (!Settings.ldap?.enable || !process.env.OVERLEAF_LDAP_CONTACTS_FILTER) {
    return []
  }

  const { attEmail, attFirstName = "", attLastName = "", attName = "" } = Settings.ldap
  const {
    url,
    timeout,
    connectTimeout,
    tlsOptions,
    starttls,
    bindDN = "",
    bindCredentials = "",
  } = Settings.ldap.server
  const searchBase = process.env.OVERLEAF_LDAP_CONTACTS_SEARCH_BASE || Settings.ldap.server.searchBase
  const searchScope = process.env.OVERLEAF_LDAP_CONTACTS_SEARCH_SCOPE || 'sub'
  const ldapConfig = { url, timeout, connectTimeout, tlsOptions }

  let ldapUsers
  const client = ldapjs.createClient(ldapConfig)
  try {
    await _upgradeToTLS(client, starttls, tlsOptions)
    await _bindLdap(client, bindDN, bindCredentials)

    const filter = await _formContactsSearchFilter(client, userId, process.env.OVERLEAF_LDAP_CONTACTS_FILTER)
    const searchOptions = { scope: searchScope, attributes: [attEmail, attFirstName, attLastName, attName], filter }

    ldapUsers = await _searchLdap(client, searchBase, searchOptions)
  } catch (error) {
    console.error('Error in fetchLdapContacts: ', error)
    return []
  } finally {
    client.unbind()
  }

  const newLdapContacts = ldapUsers.reduce((acc, ldapUser) => {
    if (!contacts.some(contact => contact.email === ldapUser[attEmail]?.toLowerCase())) {
      const [firstName, lastName] = (!attFirstName || !attLastName) && attName
        ? splitFullName(ldapUser[attName])
        : [ldapUser[attFirstName], ldapUser[attLastName]]

      acc.push({
        first_name: firstName || "",
        last_name: lastName || "",
        email: ldapUser[attEmail]?.toLowerCase(),
        type: 'user',
      })
    }
    return acc
  }, [])

  return newLdapContacts.sort((a, b) =>
    a.last_name.localeCompare(b.last_name) ||
    a.first_name.localeCompare(a.first_name) ||
    a.email.localeCompare(b.email)
  )
}

function _upgradeToTLS(client, starttls, tlsOptions) {
  return new Promise((resolve, reject) => {
    client.on('error', error => reject(new Error(`LDAP client error: ${error}`)))
    client.on('connect', () => {
      if (starttls) {
        client.starttls(tlsOptions, null, error => {
          if (error) {
            reject(new Error(`StartTLS error: ${error}`))
          } else {
            resolve()
          }
        })
      }
    })
  })
}

function _bindLdap(client, bindDN, bindCredentials) {
  return new Promise((resolve, reject) => {
    client.bind(bindDN, bindCredentials, error => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

function _searchLdap(client, baseDN, options) {
  return new Promise((resolve, reject) => {
    const searchEntries = []
    client.search(baseDN, options, (error, res) => {
      if (error) {
        reject(error)
      } else {
        res.on('searchEntry', entry => searchEntries.push(entry.object))
        res.on('error', reject)
        res.on('end', () => resolve(searchEntries))
      }
    })
  })
}

async function _formContactsSearchFilter(client, userId, contactsFilter) {
  const searchProperty = process.env.OVERLEAF_LDAP_CONTACTS_PROPERTY
  if (!searchProperty) {
    return contactsFilter
  }
  const email = await UserGetter.promises.getUserEmail(userId)
  const searchOptions = {
    scope: Settings.ldap.server.searchScope,
    attributes: [searchProperty],
    filter: `(${Settings.ldap.attEmail}=${email})`,
  }
  const searchBase = Settings.ldap.server.searchBase
  const ldapUser = (await _searchLdap(client, searchBase, searchOptions))[0]
  const searchPropertyValue = ldapUser ? ldapUser[searchProperty]
                                       : process.env.OVERLEAF_LDAP_CONTACTS_NON_LDAP_VALUE || 'IMATCHNOTHING'
  return contactsFilter.replace(/{{userProperty}}/g, searchPropertyValue)
}

module.exports = { fetchLdapContacts }
