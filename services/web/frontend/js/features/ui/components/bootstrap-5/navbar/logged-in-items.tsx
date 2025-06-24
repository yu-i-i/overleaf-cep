import { useTranslation } from 'react-i18next'
import NavDropdownMenu from '@/features/ui/components/bootstrap-5/navbar/nav-dropdown-menu'
import type { NavbarSessionUser } from '@/features/ui/components/types/navbar'
import NavLinkItem from '@/features/ui/components/bootstrap-5/navbar/nav-link-item'
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
  return (
    <>
      <NavLinkItem href="/project" className="nav-item-projects">
        {t('projects')}
      </NavLinkItem>
      <NavLinkItem href="/templates" className="nav-item-templates">
        {t('templates')}
      </NavLinkItem>
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
    </>
  )
}
