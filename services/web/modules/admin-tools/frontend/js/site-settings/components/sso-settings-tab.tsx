/**
 * SSO tabs of the Manage Site console (SSO multi-provider feature,
 * 2026-08-29) — restyled 2026-08-30 in the CE+ admin vocabulary
 * (davrot/overleaf-cep@fe4ceb6 sso-admin.pug): card + enable switch,
 * h6.text-primary section headers, row/col-md field grids,
 * form-label/form-control/form-text.
 *
 * Three provider tabs — SSO SAML / SSO OIDC / SSO LDAP — each stored under
 * `sso-saml` / `sso-oidc` / `sso-ldap`. Secrets are stored encrypted and
 * masked (placeholder shows "(configured)" when a value exists); saving an
 * empty secret keeps the stored one.
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { putJSON } from '@/infrastructure/fetch-json'
import {
  Card,
  Field,
  Hint,
  NoAutofill,
  Req,
  SaveFooter,
  SectionTitle,
  Switch
} from './ce-admin-ui'

export type SsoSection = {
  enabled: boolean
  [key: string]: unknown
}

type Flash = { saving: boolean; saved: boolean; error: string | null }
const IDLE: Flash = { saving: false, saved: false, error: null }

export function useSave(section: string) {
  const [flash, setFlash] = useState<Flash>(IDLE)
  const save = async (body: unknown): Promise<boolean> => {
    setFlash({ saving: true, saved: false, error: null })
    try {
      // NOTE: pass the OBJECT — putJSON stringifies once.
      await putJSON(`/admin/site-settings/${section}`, { body })
      setFlash({ saving: false, saved: true, error: null })
      return true
    } catch (err: unknown) {
      const message =
        (err as { data?: { message?: string } })?.data?.message ||
        (err instanceof Error ? err.message : String(err))
      setFlash({ saving: false, saved: false, error: message })
      return false
    }
  }
  return { flash, save }
}

function Two ({ a, b, cols = 'col-md-6' }: {
  a: React.ReactNode
  b?: React.ReactNode
  cols?: string
}) {
  return (
    <div className="row mb-3">
      <div className={cols}>{a}</div>
      {b && <div className={cols}>{b}</div>}
    </div>
  )
}

function SecretPlaceholder ({ set }: { set?: boolean }) {
  return set ? '•••••• (configured — leave empty to keep)' : undefined
}

function SelectField ({ id, label, value, onChange, options, required }: {
  id: string
  label: React.ReactNode
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  required?: boolean
}) {
  return (
    <>
      <label className="form-label" htmlFor={id}>
        <strong>{label}</strong>
        {required && <Req />}
      </label>
      <select
        id={id}
        className="form-select"
        value={value}
        onChange={e => onChange(e.currentTarget.value)}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </>
  )
}

// ------------------------------------------------------------------------
// SAML
// ------------------------------------------------------------------------
export function SamlSsoTab ({ section }: { section: SsoSection }) {
  const { t } = useTranslation()
  const { flash, save } = useSave('sso-saml')
  const [enabled, setEnabled] = useState(Boolean(section.enabled))
  const [serviceName, setServiceName] = useState(String(section.identityServiceName ?? ''))
  const [issuer, setIssuer] = useState(String(section.issuer ?? ''))
  const [entryPoint, setEntryPoint] = useState(String(section.entryPoint ?? ''))
  const [audience, setAudience] = useState(String(section.audience ?? ''))
  const [wantSigned, setWantSigned] = useState(Boolean(section.wantAssertionsSigned ?? true))
  const [idpCert, setIdpCert] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const certSet = Boolean(section.idpCertSet)
  const keySet = Boolean(section.privateKeySet)

  const submit = () => {
    void save({
      enabled,
      identityServiceName: serviceName,
      issuer,
      entryPoint,
      audience,
      wantAssertionsSigned: wantSigned,
      idpCert,
      privateKey
    })
  }

  return (
    <Card
      title={t('adminSite.ssoSamlTitle')}
      enabled={enabled}
      onEnabled={setEnabled}
      badge="SAML"
    >
      <Two
        a={<Field id="saml-name" label={t('adminSite.ssoServiceName')} value={serviceName} onChange={setServiceName} placeholder={t('adminSite.ssoServiceNamePh')} />}
        b={<Field id="saml-issuer" label={t('adminSite.ssoSamlIssuer')} value={issuer} onChange={setIssuer} placeholder="https://app.example.com" />}
      />
      <SectionTitle>{t('adminSite.ssoSamlIdp')}</SectionTitle>
      <Two
        a={<Field id="saml-entry" label={t('adminSite.ssoSamlEntryPoint')} required value={entryPoint} onChange={setEntryPoint} placeholder="https://idp.example.com/sso/saml" />}
        b={<Field id="saml-audience" label={t('adminSite.ssoSamlAudience')} value={audience} onChange={setAudience} placeholder={t('adminSite.ssoSamlAudiencePh')} />}
      />
      <div className="row mb-3">
        <div className="col-md-6">
          <Switch
            id="saml-signed"
            checked={wantSigned}
            onChange={setWantSigned}
            label={t('adminSite.ssoSamlWantSigned')}
          />
        </div>
      </div>
      <SectionTitle top>{t('adminSite.ssoSamlCerts')}</SectionTitle>
      <Two
        cols="col-md-12"
        a={
          <div>
            <label className="form-label" htmlFor="saml-cert"><strong>{t('adminSite.ssoSamlIdpCert')}</strong></label>
            <NoAutofill>
              <input
                id="saml-cert"
                className="form-control"
                type="password"
                autoComplete="new-password"
                value={idpCert}
                placeholder={SecretPlaceholder({ set: certSet })}
                onChange={e => setIdpCert(e.currentTarget.value)}
              />
            </NoAutofill>
            <Hint>{t('adminSite.ssoSamlIdpCertPh')}</Hint>
          </div>
        }
      />
      <Two
        cols="col-md-12"
        a={
          <div>
            <label className="form-label" htmlFor="saml-key"><strong>{t('adminSite.ssoSamlPrivateKey')}</strong></label>
            <NoAutofill>
              <input
                id="saml-key"
                className="form-control"
                type="password"
                autoComplete="new-password"
                value={privateKey}
                placeholder={SecretPlaceholder({ set: keySet })}
                onChange={e => setPrivateKey(e.currentTarget.value)}
              />
            </NoAutofill>
            <Hint>{t('adminSite.ssoSecretNote')}</Hint>
          </div>
        }
      />
      <p className="text-muted">
        {t('adminSite.ssoSamlNote')}
        <br />
        <a
          className="btn btn-sm btn-outline-secondary"
          href="/saml/metadata"
          target="_blank"
          rel="noreferrer"
        >
          {t('adminSite.ssoSamlMetadata')}
        </a>
      </p>
      <SaveFooter
        flash={flash}
        onSave={submit}
        note={t('adminSite.ssoRestartNote')}
      />
    </Card>
  )
}

// ------------------------------------------------------------------------
// OIDC
// ------------------------------------------------------------------------
export function OidcSsoTab ({ section }: { section: SsoSection }) {
  const { t } = useTranslation()
  const { flash, save } = useSave('sso-oidc')
  const [enabled, setEnabled] = useState(Boolean(section.enabled))
  const [serviceName, setServiceName] = useState(String(section.identityServiceName ?? ''))
  const [issuer, setIssuer] = useState(String(section.issuer ?? ''))
  const [authUrl, setAuthUrl] = useState(String(section.authorizationURL ?? ''))
  const [tokenUrl, setTokenUrl] = useState(String(section.tokenURL ?? ''))
  const [userInfoUrl, setUserInfoUrl] = useState(String(section.userInfoURL ?? ''))
  const [logoutUrl, setLogoutUrl] = useState(String(section.logoutURL ?? ''))
  const [clientID, setClientID] = useState(String(section.clientID ?? ''))
  const [clientSecret, setClientSecret] = useState('')
  const [scope, setScope] = useState(String(section.scope ?? 'openid profile email'))
  const secretSet = Boolean(section.clientSecretSet)

  const submit = () => {
    void save({
      enabled,
      identityServiceName: serviceName,
      issuer,
      authorizationURL: authUrl,
      tokenURL: tokenUrl,
      userInfoURL: userInfoUrl,
      logoutURL: logoutUrl,
      clientID,
      clientSecret,
      scope
    })
  }

  return (
    <Card
      title={t('adminSite.ssoOidcTitle')}
      enabled={enabled}
      onEnabled={setEnabled}
      badge="OIDC"
    >
      <Two
        a={<Field id="oidc-name" label={t('adminSite.ssoServiceName')} value={serviceName} onChange={setServiceName} placeholder={t('adminSite.ssoServiceNamePh')} />}
        b={<Field id="oidc-issuer" label={t('adminSite.ssoOidcIssuer')} required value={issuer} onChange={setIssuer} placeholder="https://accounts.example.com" />}
      />
      <SectionTitle>{t('adminSite.ssoOidcEndpoints')}</SectionTitle>
      <Two
        a={<Field id="oidc-auth" label={t('adminSite.ssoOidcAuthUrl')} value={authUrl} onChange={setAuthUrl} placeholder={t('adminSite.ssoOidcAutoDisc')} />}
        b={<Field id="oidc-token" label={t('adminSite.ssoOidcTokenUrl')} value={tokenUrl} onChange={setTokenUrl} placeholder={t('adminSite.ssoOidcAutoDisc')} />}
      />
      <Two
        a={<Field id="oidc-userinfo" label={t('adminSite.ssoOidcUserInfo')} value={userInfoUrl} onChange={setUserInfoUrl} placeholder={t('adminSite.ssoOidcAutoDisc')} />}
        b={<Field id="oidc-scope" label={t('adminSite.ssoOidcScope')} value={scope} onChange={setScope} placeholder="openid profile email" />}
      />
      <Two a={<Field id="oidc-logout" label={t('adminSite.ssoOidcLogout')} value={logoutUrl} onChange={setLogoutUrl} />} />
      <SectionTitle top>{t('adminSite.ssoOidcClient')}</SectionTitle>
      <Two
        a={<Field id="oidc-cid" label={t('adminSite.ssoOidcClientId')} required value={clientID} onChange={setClientID} />}
        b={
          <div>
            <label className="form-label" htmlFor="oidc-csecret"><strong>{t('adminSite.ssoOidcClientSecret')}</strong><Req /></label>
            <NoAutofill>
              <input
                id="oidc-csecret"
                className="form-control"
                type="password"
                autoComplete="new-password"
                value={clientSecret}
                placeholder={SecretPlaceholder({ set: secretSet })}
                onChange={e => setClientSecret(e.currentTarget.value)}
              />
            </NoAutofill>
            <Hint>{t('adminSite.ssoSecretNote')}</Hint>
          </div>
        }
      />
      <SaveFooter
        flash={flash}
        onSave={submit}
        note={t('adminSite.ssoRestartNote')}
      />
    </Card>
  )
}

// ------------------------------------------------------------------------
// LDAP
// ------------------------------------------------------------------------
export function LdapSsoTab ({ section }: { section: SsoSection }) {
  const { t } = useTranslation()
  const { flash, save } = useSave('sso-ldap')
  const [enabled, setEnabled] = useState(Boolean(section.enabled))
  const [serviceName, setServiceName] = useState(String(section.identityServiceName ?? ''))
  const [url, setUrl] = useState(String(section.url ?? ''))
  const [searchBase, setSearchBase] = useState(String(section.searchBase ?? ''))
  const [bindDN, setBindDN] = useState(String(section.bindDN ?? ''))
  const [bindCreds, setBindCreds] = useState('')
  const [searchFilter, setSearchFilter] = useState(String(section.searchFilter ?? '(uid={{username}})'))
  const [searchScope, setSearchScope] = useState(String(section.searchScope ?? 'sub'))
  const [placeholder, setPlaceholder] = useState(String(section.placeholder ?? 'Username'))
  const [emailAtt, setEmailAtt] = useState(String(section.emailAtt ?? 'mail'))
  const [firstNameAtt, setFirstNameAtt] = useState(String(section.firstNameAtt ?? 'givenName'))
  const [lastNameAtt, setLastNameAtt] = useState(String(section.lastNameAtt ?? 'sn'))
  const [isAdminAtt, setIsAdminAtt] = useState(String(section.isAdminAtt ?? ''))
  const [updateOnLogin, setUpdateOnLogin] = useState(Boolean(section.updateUserDetailsOnLogin ?? false))
  const credsSet = Boolean(section.bindCredentialsSet)

  const submit = () => {
    void save({
      enabled,
      identityServiceName: serviceName,
      url,
      searchBase,
      bindDN,
      bindCredentials: bindCreds,
      searchFilter,
      searchScope,
      placeholder,
      emailAtt,
      firstNameAtt,
      lastNameAtt,
      isAdminAtt,
      updateUserDetailsOnLogin: updateOnLogin
    })
  }

  return (
    <Card
      title={t('adminSite.ssoLdapTitle')}
      enabled={enabled}
      onEnabled={setEnabled}
      badge="LDAP"
    >
      <Two
        a={<Field id="ldap-name" label={t('adminSite.ssoServiceName')} value={serviceName} onChange={setServiceName} placeholder={t('adminSite.ssoServiceNamePh')} />}
        b={<Field id="ldap-url" label={t('adminSite.ssoLdapUrl')} required value={url} onChange={setUrl} placeholder="ldap://ldap.example.com:389" />}
      />
      <SectionTitle>{t('adminSite.ssoLdapConnect')}</SectionTitle>
      <Two
        cols="col-md-4"
        a={<Field id="ldap-binddn" label={t('adminSite.ssoLdapBindDN')} value={bindDN} onChange={setBindDN} placeholder="cn=admin,dc=example,dc=com" />}
        b={undefined}
      />
      <Two
        a={
          <div>
            <label className="form-label" htmlFor="ldap-creds"><strong>{t('adminSite.ssoLdapBindCreds')}</strong></label>
            <NoAutofill>
              <input
                id="ldap-creds"
                className="form-control"
                type="password"
                autoComplete="new-password"
                value={bindCreds}
                placeholder={SecretPlaceholder({ set: credsSet })}
                onChange={e => setBindCreds(e.currentTarget.value)}
              />
            </NoAutofill>
            <Hint>{t('adminSite.ssoSecretNote')}</Hint>
          </div>
        }
        b={<Field id="ldap-timeout" label={t('adminSite.ssoLdapTimeout')} value="10000" onChange={() => {}} placeholder="10000" disabled />}
      />
      <SectionTitle top>{t('adminSite.ssoLdapSearch')}</SectionTitle>
      <Two
        a={<Field id="ldap-base" label={t('adminSite.ssoLdapSearchBase')} required value={searchBase} onChange={setSearchBase} placeholder="ou=people,dc=example,dc=com" />}
        b={
          <SelectField
            id="ldap-scope"
            label={t('adminSite.ssoLdapScope')}
            value={searchScope}
            onChange={setSearchScope}
            options={[
              { value: 'sub', label: 'sub (subtree)' },
              { value: 'one', label: 'one (single level)' },
              { value: 'base', label: 'base' }
            ]}
          />
        }
      />
      <Two
        a={<Field id="ldap-filter" label={t('adminSite.ssoLdapFilter')} required value={searchFilter} onChange={setSearchFilter} placeholder="(uid={{username}})" hint={t('adminSite.ssoLdapFilterHint')} />}
        b={<Field id="ldap-placeholder" label={t('adminSite.ssoLdapPlaceholder')} value={placeholder} onChange={setPlaceholder} placeholder="Username" />}
      />
      <SectionTitle top>{t('adminSite.ssoLdapMapping')}</SectionTitle>
      <Two
        cols="col-md-4"
        a={<Field id="ldap-mail" label={t('adminSite.ssoLdapEmailAtt')} required value={emailAtt} onChange={setEmailAtt} placeholder="mail" />}
        b={undefined}
      />
      <Two
        a={<Field id="ldap-first" label={t('adminSite.ssoLdapFirstAtt')} value={firstNameAtt} onChange={setFirstNameAtt} placeholder="givenName" />}
        b={<Field id="ldap-last" label={t('adminSite.ssoLdapLastAtt')} value={lastNameAtt} onChange={setLastNameAtt} placeholder="sn" />}
      />
      <Two
        a={<Field id="ldap-admin" label={t('adminSite.ssoLdapAdminAtt')} value={isAdminAtt} onChange={setIsAdminAtt} placeholder="memberOf" hint={t('adminSite.ssoLdapAdminHint')} />}
        b={
          <div>
            <br />
            <Switch
              id="ldap-upd"
              checked={updateOnLogin}
              onChange={setUpdateOnLogin}
              label={t('adminSite.ssoLdapUpdate')}
            />
          </div>
        }
      />
      <SaveFooter
        flash={flash}
        onSave={submit}
        note={t('adminSite.ssoRestartNote')}
      />
    </Card>
  )
}
