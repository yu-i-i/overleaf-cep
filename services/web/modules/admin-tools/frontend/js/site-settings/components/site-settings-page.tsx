/**
 * Manage Site — admin console (site-admin only).
 *
 * Sections (SiteSettings, stored in the `site_settings` Mongo document;
 * stored value wins over environment):
 *   - Templates    : gallery on/off + categories (on/off, name,
 *                    description, template count) — user-designed spec
 *   - Zotero       : connector on/off, client key, client secret
 *                    (masked in the UI, encrypted at rest)
 *   - External URLs: linked-URL import on/off, blocked CIDR list,
 *                    allowed-resources regex
 *   - Sign Up      : registration on/off, allowed email domains
 *
 * API: GET  /admin/site-settings
 *      PUT  /admin/site-settings/<section>   (per-section, validated)
 *
 * Page chrome: the /admin/user DS-nav layout (user decision 2026-08-28) —
 * same navbar, wrapper, title and content structure as the user-list page.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from '@/shared/components/notification'
import { Dropdown } from 'react-bootstrap'
import {
  Card,
  Field,
  Hint,
  PasswordField,
  SaveFooter,
  SectionTitle,
  Switch,
  TextArea
} from './ce-admin-ui'

import { User as UserIcon } from '@phosphor-icons/react'
import { AccountMenuItems } from '@/shared/components/navbar/account-menu-items'
import { getJSON, putJSON, postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import type { NavbarSessionUser } from '@/shared/components/types/navbar'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import CookieBanner from '@/shared/components/cookie-banner'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import overleafLogoDark from '@/shared/svgs/overleaf-a-ds-solution-mallard-dark.svg'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
// (R12-2: the ThemeSelector sidebar block was removed per user; the toggle
// stays in the Account menu — theme-selector.tsx is no longer imported.)
import useThemedPage from '@/shared/hooks/use-themed-page'
import {
  SamlSsoTab,
  OidcSsoTab,
  LdapSsoTab,
} from './sso-settings-tab'
import {
  SandboxedCompilesTab,
  GitIntegrationTab,
  GithubSyncTab,
  EmailTab,
  LinkedFileTypesTab,
  MiscTab,
  PandocTab
} from './r9-settings-tabs'

type TemplateCategory = {
  key: string
  enabled: boolean
  name: string
  description: string
  publishable: boolean
}

type SiteSettings = {
  templates: {
    enabled: boolean
    categories: TemplateCategory[]
    counts?: Record<string, number | null>
    allUsersCanManageTemplates?: boolean
  }
  zotero: {
    enabled: boolean
    clientKey: string
    clientSecret: string
    clientSecretSet?: boolean
  }
  externalUrl: {
    enabled: boolean
    blockedNetworks: string[]
    allowedResourcesRegex: string
  }
  signup: { enabled: boolean; allowedEmailDomains: string[]; disabledRedirectUrl?: string }

  'sso-saml': {
    enabled: boolean
    idpCertSet?: boolean
    [key: string]: unknown
  }
  'sso-oidc': {
    enabled: boolean
    clientSecretSet?: boolean
    [key: string]: unknown
  }
  'sso-ldap': {
    enabled: boolean
    bindCredentialsSet?: boolean
    [key: string]: unknown
  }
  misc: { [key: string]: unknown }
}

type Section =
  | 'templates' | 'zotero' | 'externalUrl' | 'signup'
  | 'ssoSaml' | 'ssoOidc' | 'ssoLdap'
  | 'sandboxedCompiles' | 'gitIntegration' | 'githubSync'
  | 'email' | 'linkedFileTypes' | 'pandoc'
  | 'misc'

const SECTIONS: { id: Section; labelKey: string }[] = [
  { id: 'templates', labelKey: 'adminSite.templates' },
  { id: 'zotero', labelKey: 'adminSite.zotero' },
  { id: 'externalUrl', labelKey: 'adminSite.externalUrls' },
  { id: 'signup', labelKey: 'adminSite.signUp' },
  { id: 'ssoSaml', labelKey: 'adminSite.ssoSaml' },
  { id: 'ssoOidc', labelKey: 'adminSite.ssoOidc' },
  { id: 'ssoLdap', labelKey: 'adminSite.ssoLdap' },
  { id: 'sandboxedCompiles', labelKey: 'adminSite.sandboxedCompiles' },
  { id: 'gitIntegration', labelKey: 'adminSite.gitIntegration' },
  { id: 'githubSync', labelKey: 'adminSite.githubSync' },
  { id: 'email', labelKey: 'adminSite.email' },
  { id: 'linkedFileTypes', labelKey: 'adminSite.linkedFileTypes' },
  { id: 'pandoc', labelKey: 'adminSite.pandoc' },
  { id: 'misc', labelKey: 'adminSite.miscellaneous' },
]

function useSectionSave(section: Section) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async (body: unknown) => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      // NOTE: pass the OBJECT — fetchJSON stringifies once
      // (double-stringifying here produced a 400 body-parser error).
      await putJSON(`/admin/site-settings/${section}`, {
        body,
      })
      setSaved(true)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const flash = (
    <div>
      {error && <Notification type="error" content={error} />}
      {saved && !error && <Notification type="success" content="✓ Saved" />}
    </div>
  )

  return { saving, error, saved, save, flash }
}


/**
 * Left sidebar for /admin/site — same shell as the /admin/user sidebar
 * (user decision 2026-08-28): section list on top, account/help + CE+
 * name at the bottom (mirrors user-list sidebar-ds-nav.tsx).
 */
function ManageSidebar({
  active,
  onSelect,
}: {
  active: Section
  onSelect: (s: Section) => void
}) {
  const { t } = useTranslation()
  const sessionUser = (getMeta('ol-navbar') ?? {}) as {
    sessionUser?: NavbarSessionUser
  }
  return (
    <div className="user-list-sidebar-wrapper-react d-none d-md-flex manage-extensions-sidebar">
      <nav className="flex-grow flex-shrink" aria-label={t('manageExtensions')}>
        <div className="user-list-sidebar-scroll">
          <ul className="list-unstyled user-list-filters">
            <li className="dropdown-header">{t('manageExtensions')}</li>
            {SECTIONS.map(sec => (
              <li key={sec.id} className={active === sec.id ? 'active' : ''}>
                <button type="button" onClick={() => onSelect(sec.id)}>
                  {t(sec.labelKey)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="ds-nav-sidebar-lower">
        {/* R12-2 (2026-08-31): the sidebar Theme fieldset was removed — the
            theme toggle lives in the Account menu below (as on every other
            page); a duplicate outside the menu was rejected by the user. */}
        <nav
          className="d-flex flex-row gap-3 mb-2"
          aria-label="account help"
        >
          {sessionUser?.sessionUser ? (
            <Dropdown className="ds-nav-icon-dropdown" role="menu">
              <Dropdown.Toggle role="menuitem" aria-label={t('Account')}>
                <div>
                  <UserIcon size={24} />
                </div>
              </Dropdown.Toggle>
              <Dropdown.Menu
                as="ul"
                role="menu"
                align="end"
                popperConfig={{
                  modifiers: [{ name: 'offset', options: { offset: [-50, 5] } }],
                }}
              >
                <AccountMenuItems
                  sessionUser={sessionUser.sessionUser}
                  showSubscriptionLink={false}
                  showThemeToggle={true}
                  // keep the "Manage" accordion stable inside this menu
                />
              </Dropdown.Menu>
            </Dropdown>
          ) : null}
        </nav>
        <div className="ds-nav-ds-name" translate="no">
          <span>CE+</span>
        </div>
      </div>
    </div>
  )
}

export default function SiteSettingsPage() {
  const { t } = useTranslation()
  useThemedPage()
  const navbarProps = getMeta('ol-navbar')
  const footerProps = getMeta('ol-footer')
  const activeOverallTheme = useActiveOverallTheme()
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  const [active, setActive] = useState<Section>('templates')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    getJSON<SiteSettings>('/admin/site-settings')
      .then(data => {
        if (mounted) setSettings(data)
      })
      .catch(err => {
        if (mounted) setLoadError(err?.message || String(err))
      })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="user-ds-nav-page website-redesign red-nav-bar-for-admins manage-extensions-page">
      <DefaultNavbar
        {...(navbarProps || {})}
        overleafLogo={activeOverallTheme === 'dark' ? overleafLogoDark : overleafLogo}
        showCloseIcon
      />
      <div className="user-list-wrapper">
        <ManageSidebar active={active} onSelect={setActive} />
        <div className="user-ds-nav-content-and-messages">
          <div className="user-ds-nav-content">
            <div className="user-ds-nav-main">
              <main aria-labelledby="main-content">
                <div className="user-list-header-row">
                  <h1
                    id="main-content"
                    tabIndex={-1}
                    className="user-list-title text-truncate d-none d-md-block"
                  >
                    {t(SECTIONS.find(sec => sec.id === active)!.labelKey)}
                  </h1>
                </div>
                {loadError ? (
                  <Notification type="error" content={loadError} />
                ) : !settings ? (
                  <p>{t('loading')}</p>
                ) : (
                  <>
                    <p className="manage-extensions-intro">
                      {t('adminSiteIntro')}
                    </p>
      <div style={{ maxWidth: '900px' }}>
        {active === 'templates' && (
          <TemplatesTab
            key={`tpl-${settings.templates.enabled}`}
            initial={settings.templates}
            onApplied={(templates) =>
              setSettings(s => ({ ...s, templates: { ...templates, counts: s.templates.counts } }))
            }
          />
        )}
                      {active === 'zotero' && <ZoteroTab initial={settings.zotero} />}
                      {active === 'externalUrl' && <ExternalUrlTab initial={settings.externalUrl} />}
                      {active === 'signup' && <SignupTab initial={settings.signup} />}
                      {active === 'ssoSaml' && (
                        <SamlSsoTab key={`saml-${settings['sso-saml']?.enabled}`} section={settings['sso-saml'] ?? { enabled: false }} />
                      )}
                      {active === 'ssoOidc' && (
                        <OidcSsoTab key={`oidc-${settings['sso-oidc']?.enabled}`} section={settings['sso-oidc'] ?? { enabled: false }} />
                      )}
                      {active === 'ssoLdap' && (
                        <LdapSsoTab key={`ldap-${settings['sso-ldap']?.enabled}`} section={settings['sso-ldap'] ?? { enabled: false }} />
                      )}
                      {active === 'sandboxedCompiles' && (
                        <SandboxedCompilesTab
                          key={`sc-${settings['sandboxed-compiles']?.enabled}`}
                          initial={settings['sandboxed-compiles'] ?? { enabled: false, images: [] }}
                        />
                      )}
                      {active === 'gitIntegration' && (
                        <GitIntegrationTab
                          key={`git-${settings['git-integration']?.enabled}`}
                          initial={settings['git-integration'] ?? { enabled: false }}
                        />
                      )}
                      {active === 'githubSync' && (
                        <GithubSyncTab
                          key={`gh-${settings['github-sync']?.enabled}`}
                          initial={settings['github-sync'] ?? { enabled: false }}
                        />
                      )}
                      {active === 'email' && (
                        <EmailTab
                          key={`em-${settings.email?.skipConfirmation}`}
                          initial={settings.email ?? { driver: 'smtp', port: 587 }}
                        />
                      )}
                      {active === 'linkedFileTypes' && (
                        <LinkedFileTypesTab
                          key={`lft-${settings['linked-file-types']?.enabledTypes?.join('_')}`}
                          initial={settings['linked-file-types'] ?? { enabledTypes: ['project_file', 'project_output_file', 'url', 'zotero'] }}
                        />
                      )}
                      {active === 'pandoc' && (
                        <PandocTab
                          key={`pd-${settings.pandoc?.enabled}`}
                          initial={settings.pandoc ?? { enabled: false, image: 'pandoc-ol:3.10.0.0' }}
                        />
                      )}
                      {active === 'misc' && (
                        <MiscTab
                          key={`misc-${settings.misc?.appName}`}
                          initial={settings.misc ?? {}}
                        />
                      )}
                    </div>
                  </>
                )}
              </main>
            </div>
            <Footer {...(footerProps || {})} />
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}


/**
 * R6 item 7 (2026-08-29): table of the users with the template gallery
 * admin flag (assigned on /admin/user → Create/Update account), plus a
 * per-user "Revoke" shortcut.
 */
function TemplateAdminsTable() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<
    { id: string; email: string; firstName?: string; lastName?: string; isAdmin?: boolean; hasTemplateFlag?: boolean }[] | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = () => {
    getJSON<{ users: { id: string; email: string; firstName?: string; lastName?: string }[] }>(
      '/admin/site/template-admins'
    )
      .then(d => setUsers(d.users || []))
      .catch(err => setError(err?.data?.message || t('Could not load the template admin list')))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const revoke = (u: { id: string; email: string }) => {
    setBusyId(u.id)
    void postJSON(`/admin/user/${u.id}/update`, { body: { canManageTemplates: false } })
      .then(refresh)
      .catch(err => setError(err?.data?.message || t('Could not revoke the template admin role')))
      .finally(() => setBusyId(null))
  }

  return (
    <div className="mt-3 pt-3 border-top">
      <h6 className="text-primary border-bottom pb-2 mb-3">{t('Template gallery admins')}</h6>
      <p className="text-muted">
        {t('Template gallery admins can manage templates (create, edit in place, download/import bundles) without full site admin powers. Assign the role on the user page (Create / Update account).')}
      </p>
      {error && (
        <Notification type="error" content={error} isDismissible onDismiss={() => setError(null)} />
      )}
      {(users || []).length === 0 ? (
        <Hint>{t('No users have the template gallery admin role yet.')}</Hint>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('email')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(users || []).map(u => {
              const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
              return (
              <tr key={u.id}>
                <td>
                  {fullName || u.email}
                  {u.isAdmin ? (
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '2px' }}>{t('Site admin')}</div>
                  ) : (
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '2px' }}>{t('Template gallery admin')}</div>
                  )}
                </td>
                <td>
                  <a href={`/admin/user/${u.id}`}>{u.email}</a>
                </td>
                <td className="text-right">
                  {/* R12-12: site admins are granted gallery admin via the
                      site-admin role — Revoke would only clear the extra flag
                      and mislead (they'd keep access). Only non-admin flagged
                      users get the Revoke button. */}
                  {!u.isAdmin && u.hasTemplateFlag ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      disabled={busyId === u.id}
                      onClick={() => revoke(u)}
                    >
                      {t('Revoke')}
                    </button>
                  ) : (
                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>{t('Managed via site-admin role')}</span>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function TemplatesTab({
  initial,
  onApplied,
}: {
  initial: SiteSettings['templates']
  onApplied: (t: SiteSettings['templates']) => void
}) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [categories, setCategories] = useState<TemplateCategory[]>(initial.categories)
  const [allUsersAdmin, setAllUsersAdmin] = useState(Boolean(initial.allUsersCanManageTemplates))
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ name: string; description: string }>({
    name: '',
    description: '',
  })
  const { saving, save, flash } = useSectionSave('templates')

  const counts = initial.counts || {}
  const openEdit = (cat: TemplateCategory) => {
    setEditKey(cat.key)
    setEditDraft({ name: cat.name, description: cat.description || '' })
  }

  return (
    <Card
      title={t('adminSite.templates')}
      badge="tex"
    >
      <p className="text-muted">{t('adminSite.templatesGallery')}</p>
      <div className="row mb-3">
        <div className="col-md-6">
          <Switch
            id="tpl-gallery"
            checked={enabled}
            onChange={setEnabled}
            label={<><strong>{t('adminSite.templatesGallery')}</strong></>}
          />
          <Hint>{t('adminSite.templatesGalleryHelper')}</Hint>
        </div>
        <div className="col-md-6">
          <Switch
            id="tpl-admins"
            checked={allUsersAdmin}
            onChange={setAllUsersAdmin}
            label={<><strong>{t('adminSite.allUsersTemplateAdmins')}</strong></>}
          />
          <Hint>{t('adminSite.allUsersTemplateAdminsHelper')}</Hint>
        </div>
      </div>
      <SectionTitle>{t('adminSite.tplCategories')}</SectionTitle>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>{t('name')}</th>
            <th>{t('status')}</th>
            <th title={t('adminSite.publishableHelper')}>{t('adminSite.publishable')}</th>
            <th>{t('templatesCount')}</th>
            <th>{t('description')}</th>
            <th aria-label={t('adminSite.editAriaLabel')} />
          </tr>
        </thead>
        <tbody>
          {categories.map(cat => (
            <tr key={cat.key}>
              <td>
                <a href={`/templates/${cat.key}`}>{cat.name}</a>
              </td>
              <td>
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`tpl-cat-on-${cat.key}`}
                    checked={cat.enabled}
                    onChange={e =>
                      setCategories(cs =>
                        cs.map(c =>
                          c.key === cat.key
                            ? { ...c, enabled: e.currentTarget.checked }
                            : c
                        )
                      )
                    }
                    aria-label={`${cat.name} enabled`}
                  />
                </div>
              </td>
              <td>
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`tpl-cat-pub-${cat.key}`}
                    checked={cat.publishable !== false}
                    onChange={e =>
                      setCategories(cs =>
                        cs.map(c =>
                          c.key === cat.key
                            ? { ...c, publishable: e.currentTarget.checked }
                            : c
                        )
                      )
                    }
                    aria-label={`${cat.name} publishable`}
                  />
                </div>
              </td>
              <td>
                {counts[cat.key] === null || counts[cat.key] === undefined ? '—' : counts[cat.key]}
              </td>
              <td className="ce-admin-desc">{cat.description || '—'}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => openEdit(cat)}
                >
                  {t('edit')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Hint>
        {t('template_bundles_pointer')}{' '}
        <a href="/templates/manage">{t('adminSite.template_bundles_href') || '/templates/manage'}</a>{' '}
        {t('template_bundles_pointer_end')}
      </Hint>
      <TemplateAdminsTable />
      <SaveFooter
        flash={flash}
        saving={saving}
        onSave={() => {
          void save({ enabled, categories, allUsersCanManageTemplates: allUsersAdmin }).then(ok => {
            if (ok) onApplied({ enabled, categories, allUsersCanManageTemplates: allUsersAdmin })
          })
        }}
      />

      {editKey && (
        <div
          role="dialog"
          aria-modal="true"
          className="ce-admin-modal-backdrop"
        >
          <div className="ce-admin-modal card">
            <div className="card-header">
              <span>{t('adminSite.editCategory')} — {editKey}</span>
            </div>
            <div className="card-body">
              <div className="mb-3">
                <Field
                  id={`tpl-name-${editKey}`}
                  label={t('name')}
                  value={editDraft.name}
                  onChange={v => setEditDraft(d => ({ ...d, name: v }))}
                />
              </div>
              <div className="mb-3">
                <TextArea
                  id={`tpl-desc-${editKey}`}
                  label={t('description')}
                  rows={3}
                  value={editDraft.description}
                  onChange={v => setEditDraft(d => ({ ...d, description: v }))}
                />
              </div>
            </div>
            <div className="card-footer d-flex justify-content-end gap-2">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setEditKey(null)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCategories(cs =>
                    cs.map(c => (c.key === editKey ? { ...c, ...editDraft } : c))
                  )
                  setEditKey(null)
                }}
              >
                {t('adminSite.applyDraft')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function ZoteroTab({ initial }: { initial: SiteSettings['zotero'] }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [clientKey, setClientKey] = useState(initial.clientKey)
  const [clientSecret, setClientSecret] = useState('')
  const { saving, save, flash } = useSectionSave('zotero')

  return (
    <Card
      title={t('adminSite.zotero')}
      enabled={enabled}
      onEnabled={setEnabled}
      badge="zotero"
    >
      <p className="text-muted">{t('adminSite.zoteroDesc')}</p>
      <SectionTitle>{t('adminSite.zoteroCreds')}</SectionTitle>
      <div className="row mb-3">
        <div className="col-md-6">
          <Field
            id="zotero-key"
            label={t('adminSite.zoteroClientKey')}
            required
            value={clientKey}
            onChange={setClientKey}
            placeholder="zotero_xxx"
          />
        </div>
      </div>
      <PasswordField
        id="zotero-secret"
        label={t('adminSite.zoteroClientSecret')}
        value={clientSecret}
        onChange={setClientSecret}
        set={Boolean(initial.clientSecretSet)}
        hint={t('adminSite.zoteroSecretNote')}
      />
      <SaveFooter
        flash={{ ...flash, saving }}
        saving={saving}
        onSave={() =>
          void save({ enabled, clientKey, clientSecret })
        }
      />
    </Card>
  )
}

function ExternalUrlTab({ initial }: { initial: SiteSettings['externalUrl'] }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [net, setNet] = useState((initial.blockedNetworks || []).join('\n'))
  const [regex, setRegex] = useState(initial.allowedResourcesRegex || '')
  const { saving, save, flash } = useSectionSave('externalUrl')

  return (
    <Card
      title={t('adminSite.externalUrls')}
      enabled={enabled}
      onEnabled={setEnabled}
      badge="urls"
    >
      <p className="text-muted">{t('adminSite.extDesc')}</p>
      <SectionTitle>{t('adminSite.extNetwork')}</SectionTitle>
      <TextArea
        id="ext-net"
        label={t('adminSite.blockedNetworks')}
        rows={5}
        value={net}
        onChange={setNet}
        placeholder={'10.0.0.0/8\n192.168.0.0/16'}
        hint={t('adminSite.blockedNetworksHelper')}
      />
      <Field
        id="ext-regex"
        label={t('adminSite.allowedResourcesRegex')}
        value={regex}
        onChange={setRegex}
        placeholder=".*\.uni-bremen\.de/.*"
        hint={t('adminSite.allowedResourcesRegexHelper')}
      />
      <SaveFooter
        flash={flash}
        saving={saving}
        onSave={() =>
          void save({
            enabled,
            blockedNetworks: net
              .split(/\r?\n+/)
              .map(s => s.trim())
              .filter(Boolean),
            allowedResourcesRegex: regex,
          })
        }
      />
    </Card>
  )
}

function SignupTab({ initial }: { initial: SiteSettings['signup'] }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [domains, setDomains] = useState((initial.allowedEmailDomains || []).join(', '))
  const [disabledRedirect, setDisabledRedirect] = useState(
    (initial as { disabledRedirectUrl?: string }).disabledRedirectUrl || ''
  )
  const { saving, save, flash } = useSectionSave('signup')

  return (
    <Card
      title={t('adminSite.signUp')}
      enabled={enabled}
      onEnabled={setEnabled}
      badge="users"
    >
      <p className="text-muted">{t('adminSite.signUpHelper')}</p>
      <SectionTitle>{t('adminSite.signUpRestrictions')}</SectionTitle>
      <Field
        id="signup-domains"
        label={t('adminSite.allowedEmailDomains')}
        value={domains}
        onChange={setDomains}
        placeholder="example.org, example.edu"
        hint={t('adminSite.allowedEmailDomainsHelper')}
      />
      <Field
        id="signup-redirect"
        label={t('adminSite.disabledRedirectUrl')}
        value={disabledRedirect}
        onChange={setDisabledRedirect}
        placeholder="/login, https://example.org/join …"
        hint={t('adminSite.disabledRedirectUrlHelper')}
      />
      <SaveFooter
        flash={flash}
        saving={saving}
        onSave={() =>
          void save({
            enabled,
            allowedEmailDomains: domains.split(/[,\s]+/).filter(Boolean),
            disabledRedirectUrl: disabledRedirect.trim(),
          })
        }
      />
    </Card>
  )
}
