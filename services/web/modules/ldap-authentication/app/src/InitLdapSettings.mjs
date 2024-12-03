import Settings from '@overleaf/settings'

function initLdapSettings() {
  Settings.ldap = {
    enable: true,
    placeholder:  process.env.OVERLEAF_LDAP_PLACEHOLDER || 'Username',
    attEmail:     process.env.OVERLEAF_LDAP_EMAIL_ATT || 'mail',
    attFirstName: process.env.OVERLEAF_LDAP_FIRST_NAME_ATT,
    attLastName:  process.env.OVERLEAF_LDAP_LAST_NAME_ATT,
    attName:      process.env.OVERLEAF_LDAP_NAME_ATT,
    attAdmin:     process.env.OVERLEAF_LDAP_IS_ADMIN_ATT,
    valAdmin:     process.env.OVERLEAF_LDAP_IS_ADMIN_ATT_VALUE,
    updateUserDetailsOnLogin: String(process.env.OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN ).toLowerCase() === 'true',
  }
}

export default initLdapSettings
