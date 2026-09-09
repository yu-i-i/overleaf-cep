import { useTranslation } from 'react-i18next'
import NavDropdownMenu from '@/shared/components/navbar/nav-dropdown-menu'
import type { NavbarSessionUser } from '@/shared/components/types/navbar'
import NavLinkItem from '@/shared/components/navbar/nav-link-item'
import { AccountMenuItems } from './account-menu-items'
import { useSendProjectListMB } from '@/features/project-list/components/project-list-events'

export default function LoggedInItems({
  sessionUser,
  showSubscriptionLink,
}: {
  sessionUser: NavbarSessionUser
  showSubscriptionLink: boolean
}) {
  const { t } = useTranslation()
  const sendProjectListMB = useSendProjectListMB()

  // R11 item 2/3 (user, 2026-08-30): the top navbar of the plain user pages
  // (/project, /library) carries ONLY the Library / Templates / Projects
  // links — the Account dropdown is removed there (the user's desired
  // markup). The Account item stays on /templates and everywhere else the
  // shared default-navbar is used (e.g. /templates/manage).
  const pathName =
    typeof window !== 'undefined' ? window.location.pathname : ''
  const suppressAccountItem =
    pathName === '/project' ||
    pathName === '/library' ||
    pathName.startsWith('/library/')

  return (
    <>
      <NavLinkItem href="/project" className="nav-item-projects">
        {t('projects')}
      </NavLinkItem>
      {/* Templates lives in the left sidebar page switcher
          (DsNavPageSwitcher), per the SaaS layout (bib-editor
          LIBRARY_PLAN D-C4) — not in the top navbar. */}
      {!suppressAccountItem && (
        <NavDropdownMenu
        title={t('Account')}
        className="nav-item-account"
        onToggle={nextShow => {
          if (nextShow) {
            sendProjectListMB('menu-expand', {
              item: 'account',
              location: 'top-menu',
            })
          }
        }}
      >
        <AccountMenuItems
          sessionUser={sessionUser}
          showSubscriptionLink={showSubscriptionLink}
        />
        </NavDropdownMenu>
      )}
    </>
  )
}
