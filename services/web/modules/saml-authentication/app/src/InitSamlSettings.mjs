import Settings from '@overleaf/settings'

function initSamlSettings() {
  Settings.saml = {
    enable: true,
    identityServiceName: process.env.OVERLEAF_SAML_IDENTITY_SERVICE_NAME || 'Login with SAML IdP',
    attEmail:     process.env.OVERLEAF_SAML_EMAIL_FIELD || 'nameID',
    attFirstName: process.env.OVERLEAF_SAML_FIRST_NAME_FIELD || 'givenName',
    attLastName:  process.env.OVERLEAF_SAML_LAST_NAME_FIELD || 'lastName',
    attAdmin:     process.env.OVERLEAF_SAML_IS_ADMIN_FIELD,
    valAdmin:     process.env.OVERLEAF_SAML_IS_ADMIN_FIELD_VALUE,
    updateUserDetailsOnLogin: String(process.env.OVERLEAF_SAML_UPDATE_USER_DETAILS_ON_LOGIN).toLowerCase() === 'true',
  }
}

export default initSamlSettings
