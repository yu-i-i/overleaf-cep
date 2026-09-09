/**
 * PSH — DS-nav shell chrome (N-2 structural rebuild, 2026-09-01).
 *
 * Renders the SAME shared React chrome the golden /admin/site page
 * (modules/admin-tools ... site-settings-page.tsx) renders, into mount
 * points owned by the static pug shells (admin-panel.pug /
 * user-my-settings.pug):
 *
 *   * DefaultNavbar — the page navbar, mounted INSIDE the .user-ds-nav-page
 *     div so the shared CSS applies exactly as on the golden (the red admin
 *     gradient of /admin/panel, and the lg+ hiding of the navbar account /
 *     help items on both shells);
 *   * AccountMenuItems dropdown (email, Projects, nav extras, Manage
 *     accordion, Theme toggle, Log out) — the sidebar account block in
 *     .ds-nav-sidebar-lower, using the shared ace.overallTheme store
 *     (same POST /user/settings write as every other page);
 *   * Footer + CookieBanner — the golden's content-column slots.
 *
 * Provider wiring mirrors SiteSettingsRoot (SplitTestProvider +
 * UserSettingsProvider); theming mirrors site-settings-page.tsx
 * (useThemedPage + useActiveOverallTheme for the themed DS logo).
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Dropdown } from 'react-bootstrap'
import { User as UserIcon } from '@phosphor-icons/react'
import getMeta from '@/utils/meta'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import useThemedPage from '@/shared/hooks/use-themed-page'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import { AccountMenuItems } from '@/shared/components/navbar/account-menu-items'
import Footer from '@/shared/components/footer/footer'
import CookieBanner from '@/shared/components/cookie-banner'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import overleafLogoDark from '@/shared/svgs/overleaf-a-ds-solution-mallard-dark.svg'

type NavbarMeta = React.ComponentProps<typeof DefaultNavbar>
type FooterMeta = React.ComponentProps<typeof Footer>

function ShellNavbar() {
  useThemedPage()
  const activeOverallTheme = useActiveOverallTheme()
  const meta = (getMeta('ol-navbar') ?? {}) as NavbarMeta
  return (
    <DefaultNavbar
      {...meta}
      overleafLogo={
        activeOverallTheme === 'dark' ? overleafLogoDark : overleafLogo
      }
    />
  )
}

function ShellAccountMenu() {
  // N-2 (2026-09-01, user re-report 1A/1B): the theme toggle lives in THIS
  // provider tree (the account menu hosts AccountMenuItems > ThemeToggle),
  // but the earlier rebuild only applied `useThemedPage()` in the Navbar's
  // SEPARATE provider instance — so switching the theme never re-applied
  // body[data-theme] and the whole page (header + content) stayed put.
  // Applying it here (in the tree that owns the toggle) writes the shared
  // body[data-theme] attribute, so every part of the page — navbar, sidebar
  // and the themed content surface — follows the selected theme, exactly
  // like the single-provider golden /admin/site. (Hook order: this is the
  // unconditional first hook call, before any early return.)
  useThemedPage()
  const { isReady, error } = useWaitForI18n()
  if (!isReady) {
    if (error) throw error
    // i18n still loading: keep the slot empty (avoids an empty flash of
    // the menu items).
    return null
  }
  const meta = (getMeta('ol-navbar') ?? {}) as NavbarMeta
  const sessionUser = meta?.sessionUser
  if (!sessionUser?.email) {
    // Not logged in — the shells only render for logged-in users, so this
    // is a defensive fallback.
    return null
  }
  return (
    // EXACT golden /admin/site account dropdown (site-settings-page.tsx):
    // react-bootstrap Dropdown (React-managed — pages without Bootstrap JS
    // included still toggle), 24px UserIcon, menu as <ul> with the shared
    // AccountMenuItems (theme toggle, Manage accordion, Log out).
    <Dropdown className="ds-nav-icon-dropdown" role="menu">
      <Dropdown.Toggle role="menuitem" aria-label="Account">
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
          sessionUser={sessionUser}
          showSubscriptionLink={false}
          showThemeToggle={true}
        />
      </Dropdown.Menu>
    </Dropdown>
  )
}

function ShellFooter() {
  const meta = (getMeta('ol-footer') ?? {}) as FooterMeta
  return <Footer {...meta} />
}

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SplitTestProvider>
      <UserSettingsProvider>{children}</UserSettingsProvider>
    </SplitTestProvider>
  )
}

function NavbarRoot() {
  return (
    <Providers>
      <ShellNavbar />
    </Providers>
  )
}

function AccountRoot() {
  return (
    <Providers>
      <ShellAccountMenu />
    </Providers>
  )
}

function FooterRoot() {
  return (
    <Providers>
      <ShellFooter />
    </Providers>
  )
}

function CookieRoot() {
  return (
    <Providers>
      <CookieBanner />
    </Providers>
  )
}

const SafeNavbar = withErrorBoundary(NavbarRoot, () => (
  <GenericErrorBoundaryFallback />
))
const SafeAccount = withErrorBoundary(AccountRoot, () => (
  <GenericErrorBoundaryFallback />
))
const SafeFooter = withErrorBoundary(FooterRoot, () => (
  <GenericErrorBoundaryFallback />
))
const SafeCookie = withErrorBoundary(CookieRoot, () => (
  <GenericErrorBoundaryFallback />
))

function mountInto(id: string, element: React.ReactElement) {
  const el = document.getElementById(id)
  if (!el) return
  const root = createRoot(el)
  root.render(element)
}

export function renderDsNavChrome({
  navbarRootId,
  accountRootId,
  footerRootId,
  cookieRootId,
}: {
  navbarRootId?: string
  accountRootId?: string
  footerRootId?: string
  cookieRootId?: string
}) {
  if (navbarRootId) mountInto(navbarRootId, <SafeNavbar />)
  if (accountRootId) mountInto(accountRootId, <SafeAccount />)
  if (footerRootId) mountInto(footerRootId, <SafeFooter />)
  if (cookieRootId) mountInto(cookieRootId, <SafeCookie />)
}

export default renderDsNavChrome
