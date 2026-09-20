import classnames from 'classnames'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLDropdown,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import { User as UserIcon } from '@phosphor-icons/react'
import { usePersistedResize } from '@/shared/hooks/use-resize'
import getMeta from '@/utils/meta'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { AccountMenuItems } from '@/shared/components/navbar/account-menu-items'
import SidebarFilters from './sidebar-filters'
import CreateAccountButton from '../create-account-button'
import { useSendUserListMB } from '../user-list-events'
import { useScrolled } from '@/features/project-list/components/sidebar/use-scroll'
import { SidebarLowerSection } from '@/shared/components/sidebar/sidebar-lower-section'

function SidebarDsNav() {
  const { t } = useTranslation()
  const [showAccountDropdown, setShowAccountDropdown] = useState(false)
  const { mousePos, getHandleProps, getTargetProps } = usePersistedResize({
    name: 'users-and-projects-sidebar',
  })
  const sendMB = useSendUserListMB()
  const { sessionUser } = getMeta('ol-navbar')
  const { containerRef, scrolledUp, scrolledDown } = useScrolled()
  return (
    <div
      className="user-list-sidebar-wrapper-react d-none d-md-flex"
      {...getTargetProps({
        style: {
          ...(mousePos?.x && { flexBasis: `${mousePos.x}px` }),
        },
      })}
    >
      <nav
        className="flex-grow flex-shrink"
        aria-label={t('user_categories')}
      >
        <CreateAccountButton
          id="create-account-button-sidebar"
          className={scrolledDown ? 'show-shadow' : undefined}
        />
        <div
          className="user-list-sidebar-scroll"
          ref={containerRef}
          data-testid="user-list-sidebar-scroll"
        >
          <SidebarFilters />
        </div>
      </nav>
      <div
        className={classnames(
          'ds-nav-sidebar-lower',
          scrolledUp && 'show-shadow'
        )}
      >
        <SidebarLowerSection showThemeToggle />
      </div>
      <div
        {...getHandleProps({
          style: {
            position: 'absolute',
            zIndex: 1,
            top: 0,
            right: '-2px',
            height: '100%',
            width: '4px',
          },
        })}
      />
    </div>
  )
}

export default SidebarDsNav
