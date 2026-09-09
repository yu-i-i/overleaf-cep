import { useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import type { NavbarLinkItemData, NavbarSessionUser } from '@/shared/components/types/navbar'
import DropdownListItem from '@/shared/components/dropdown/dropdown-list-item'
import NavDropdownDivider from './nav-dropdown-divider'
import NavDropdownLinkItem from './nav-dropdown-link-item'
import { useDsNavStyle } from '@/features/project-list/components/use-is-ds-nav'
import { CaretRight, SignOut } from '@phosphor-icons/react'
import ThemeToggle from '@/features/project-list/components/sidebar/theme-toggle'

/**
 * "Manage" sub-folder (user design 2026-08-28, round 4): an INLINE
 * accordion — click "Manage" and the four site-management links unfold
 * directly below it (the flyout version did not unfold in the reported
 * browser sessions; inline cannot be clipped/positioning-sensitive).
 * Chevron: ">" (CaretRight), rotates down when open.
 *
 * Naming (user round 3): the historical Admin Panel keeps the name
 * "Manage Site"; the settings console (/admin/site) is
 * "Manage Extensions".
 *
 * W8 (UI-R10, 2026-08-30): the menu now points at this fork's SAME-ORIGIN
 * shells — /admin/panel (the upstream admin tabset) and /user/mysettings
 * (the upstream account-settings app, themed) — from the page-shells
 * module. The original upstream URLs keep working.
 */
function ManageMenu({
  canManageProjects,
  canDisplayInstanceStats = false,
}: { canManageProjects: boolean; canDisplayInstanceStats?: boolean }) {
  const [open, setOpen] = useState(false)
  const items = [
    { href: '/admin/panel', label: 'Manage Site' },
    { href: '/admin/site', label: 'Manage Extensions' },
    { href: '/admin/user', label: 'Manage Users' },
  ]
  // N-D (2026-09-01): instance-statistics dashboards — first item of the
  // Manage submenu (requirement: above "Manage Site").
  if (canDisplayInstanceStats) {
    items.unshift({ href: '/admin/instance-stats', label: 'Dashboard' })
  }
  if (canManageProjects) items.push({ href: '/admin/project', label: 'Manage Projects' })
  return (
    <>
      <li role="none">
        <button
          type="button"
          role="menuitem"
          className="dropdown-item manage-submenu-toggle d-flex align-items-center justify-content-between"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span>Manage</span>
          <CaretRight
            size={14}
            weight="bold"
            className={`manage-menu-caret ${open ? 'is-open' : ''}`}
          />
        </button>
      </li>
      {open ? items.map(item => (
        <li key={item.href} role="none">
          <a href={item.href} role="menuitem" className="dropdown-item manage-menu-link">
            {item.label}
          </a>
        </li>
      )) : null}
    </>
  )
}

/**
 * Nav-extra links (SaaS layout: Library, Templates — see
 * settings.defaults.js nav.header_extras → ol-navbar meta `items`).
 * The account menu (sidebar lower section) shows the same items the top
 * navbar shows, using the same visibility rules as default-navbar.tsx.
 */
function useNavExtraItems(sessionUser: NavbarSessionUser | undefined) {
  const items = getMeta('ol-navbar')?.items ?? []
  const suppressNavContentLinks =
    getMeta('ol-navbar')?.suppressNavContentLinks ?? false
  return items.filter((item): item is NavbarLinkItemData => {
    if (!('url' in item)) return false
    if (item.only_when_logged_in && item.only_when_logged_out) return false
    if (item.only_when_logged_in && !sessionUser) return false
    if (item.only_when_logged_out && sessionUser) return false
    if (item.only_content_pages) return !suppressNavContentLinks
    return true
  })
}

export function AccountMenuItems({
  sessionUser,
  showSubscriptionLink,
  showThemeToggle = false,
}: {
  sessionUser: NavbarSessionUser
  showSubscriptionLink: boolean
  showThemeToggle?: boolean
}) {
  const { t } = useTranslation()
  const logOutFormId = 'logOutForm'
  const dsNavStyle = useDsNavStyle()
  const hasOverallThemes = Boolean(getMeta('ol-overallThemes'))
  const navExtraItems = useNavExtraItems(sessionUser)
  // Admin section parity with the top navbar's Admin dropdown
  // (admin-menu.tsx): same items, same flag-based visibility rules.
  const nav = (getMeta('ol-navbar') ?? {}) as {
    canDisplayAdminMenu?: boolean
    canDisplayProjectUrlLookup?: boolean
    canDisplayAdminRedirect?: boolean
    canDisplaySplitTestMenu?: boolean
    canDisplaySurveyMenu?: boolean
    canDisplayScriptLogMenu?: boolean
    adminUrl?: string
  }

  return (
    <>
      <Dropdown.Item as="li" disabled role="menuitem">
        {sessionUser.email}
      </Dropdown.Item>
      <NavDropdownDivider />
      <NavDropdownLinkItem href="/project">{t('projects')}</NavDropdownLinkItem>
      {navExtraItems.map((item, index) => (
        <NavDropdownLinkItem key={index} href={item.url}>
          {item.translatedText || item.text}
        </NavDropdownLinkItem>
      ))}
      <NavDropdownLinkItem href="/user/mysettings">
        {t('account_settings')}
      </NavDropdownLinkItem>
      {showSubscriptionLink ? (
        <NavDropdownLinkItem href="/user/subscription">
          {t('subscription')}
        </NavDropdownLinkItem>
      ) : null}
      {/* R9 item 5 (2026-08-29): template gallery management lives in the
          account menu (site admins + template gallery admins only), directly
          above the Manage submenu. */}
      {getMeta('ol-ExposedSettings')?.canManageTemplatesMenu ? (
        <NavDropdownLinkItem href="/templates/manage">
          {t('Manage template gallery')}
        </NavDropdownLinkItem>
      ) : null}
      {(nav.canDisplayAdminMenu || nav.canDisplayProjectUrlLookup || nav.canDisplayAdminRedirect || nav.canDisplaySplitTestMenu || nav.canDisplaySurveyMenu || nav.canDisplayScriptLogMenu) && (
        <>
          <NavDropdownDivider />
          {(nav.canDisplayAdminMenu || nav.canDisplayProjectUrlLookup) ? (
            <ManageMenu
              canManageProjects={Boolean(nav.canDisplayProjectUrlLookup)}
              canDisplayInstanceStats={Boolean(
                (nav as { canDisplayInstanceStats?: boolean })
                  .canDisplayInstanceStats
              )}
            />
          ) : null}
          {nav.canDisplayAdminRedirect && nav.adminUrl ? (
            <NavDropdownLinkItem href={nav.adminUrl}>
              Switch to Admin
            </NavDropdownLinkItem>
          ) : null}
          {nav.canDisplaySplitTestMenu ? (
            <NavDropdownLinkItem href="/admin/split-test">
              Manage Feature Flags
            </NavDropdownLinkItem>
          ) : null}
          {nav.canDisplaySurveyMenu ? (
            <NavDropdownLinkItem href="/admin/survey">
              Manage Surveys
            </NavDropdownLinkItem>
          ) : null}
          {nav.canDisplayScriptLogMenu ? (
            <NavDropdownLinkItem href="/admin/script-logs">
              View Script Logs
            </NavDropdownLinkItem>
          ) : null}
        </>
      )}
      {showThemeToggle && hasOverallThemes && (
        <DropdownListItem>
          <ThemeToggle />
        </DropdownListItem>
      )}

      <NavDropdownDivider />
      <DropdownListItem>
        {
          // The button is outside the form but still belongs to it via the
          // form attribute. The reason to do this is that if the button is
          // inside the form, screen readers will not count it in the total
          // number of menu items
        }
        <Dropdown.Item
          as="button"
          type="submit"
          form={logOutFormId}
          role="menuitem"
          className="d-flex align-items-center justify-content-between"
        >
          <span>{t('log_out')}</span>
          {dsNavStyle && <SignOut size={16} />}
        </Dropdown.Item>
        <form id={logOutFormId} method="POST" action="/logout">
          <input type="hidden" name="_csrf" value={getMeta('ol-csrfToken')} />
        </form>
      </DropdownListItem>
    </>
  )
}
