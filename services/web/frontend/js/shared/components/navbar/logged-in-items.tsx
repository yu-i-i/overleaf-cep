import { useTranslation } from 'react-i18next'
import NavDropdownMenu from '@/shared/components/navbar/nav-dropdown-menu'
import type { NavbarSessionUser } from '@/shared/components/types/navbar'
import NavLinkItem from '@/shared/components/navbar/nav-link-item'
import { AccountMenuItems } from './account-menu-items'
import { useSendProjectListMB } from '@/features/project-list/components/project-list-events'
import getMeta from '@/utils/meta'

export default function LoggedInItems({
  sessionUser,
  showSubscriptionLink,
}: {
  sessionUser: NavbarSessionUser
  showSubscriptionLink: boolean
}) {
  const { t } = useTranslation()
  const sendProjectListMB = useSendProjectListMB()
  const { templatesEnabled } = getMeta('ol-ExposedSettings')

  return (
    <>
      <NavLinkItem href="/project" className="nav-item-projects">
        {t('projects')}
      </NavLinkItem>
      {templatesEnabled && (
        <NavLinkItem href="/templates" className="nav-item-templates">
          {t('templates')}
        </NavLinkItem>
      )}
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
