import classnames from 'classnames'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown } from 'react-bootstrap'
import { User as UserIcon } from '@phosphor-icons/react'
import { usePersistedResize } from '@/shared/hooks/use-resize'
import getMeta from '@/utils/meta'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { AccountMenuItems } from '@/shared/components/navbar/account-menu-items'
import { useFeatureFlag } from '@/shared/context/split-test-context'
import SidebarFilters from './sidebar-filters'
import { getUserName } from '../../util/user'
import { useAdminPanelContext } from '../../../admin-panel-context'
import { useScrolled } from '@/features/project-list/components/sidebar/use-scroll'
import { useSendProjectListMB } from '@/features/project-list/components/project-list-events'

function SidebarDsNav() {
  const { t } = useTranslation()
  const [showAccountDropdown, setShowAccountDropdown] = useState(false)
  const [showHelpDropdown, setShowHelpDropdown] = useState(false)
  const { mousePos, getHandleProps, getTargetProps } = usePersistedResize({
    name: 'admin-project-sidebar',
  })
  const sendMB = useSendProjectListMB()
  const { sessionUser } = getMeta('ol-navbar')
  const { containerRef, scrolledUp } = useScrolled()
  const themedDsNav = useFeatureFlag('themed-project-dashboard')
  const { showUsers, page } = useAdminPanelContext()
  const userName = getUserName(page.user)

  return (
    <div
      className="project-list-sidebar-wrapper-react d-none d-md-flex"
      {...getTargetProps({
        style: {
          ...(mousePos?.x && { flexBasis: `${mousePos.x}px` }),
        },
      })}
    >
      <nav
        className="flex-grow flex-shrink"
        aria-label={t('project_categories_tags')}
      >
        <div className="ps-3 fs-5 fw-bold" translate="no">
          {userName}
        </div>
        <div
          className="project-list-sidebar-scroll"
          ref={containerRef}
          data-testid="project-list-sidebar-scroll"
        >
          <SidebarFilters />
          <ul className="list-unstyled project-list-filters">
            <li>
              <button type="button" onClick={showUsers}>
                {t('Back to User List')}
              </button>
            </li>
            <li aria-hidden="true">
              <hr />
            </li>
          </ul>
        </div>
      </nav>
      <div
        className={classnames(
          'ds-nav-sidebar-lower',
          scrolledUp && 'show-shadow'
        )}
      >
        <nav
          className="d-flex flex-row gap-3 mb-2"
          aria-label={t('account_help')}
        >
          {sessionUser && (
            <>
              <Dropdown
                className="ds-nav-icon-dropdown"
                onToggle={show => {
                  setShowAccountDropdown(show)
                  if (show) {
                    sendMB('menu-expand', {
                      item: 'account',
                      location: 'sidebar',
                    })
                  }
                }}
                role="menu"
              >
                <Dropdown.Toggle role="menuitem" aria-label={t('Account')}>
                  <OLTooltip
                    description={t('Account')}
                    id="open-account"
                    overlayProps={{
                      placement: 'top',
                    }}
                    hidden={showAccountDropdown}
                  >
                    <div>
                      <UserIcon size={24} />
                    </div>
                  </OLTooltip>
                </Dropdown.Toggle>
                <Dropdown.Menu
                  as="ul"
                  role="menu"
                  align="end"
                  popperConfig={{
                    modifiers: [
                      { name: 'offset', options: { offset: [-50, 5] } },
                    ],
                  }}
                >
                  <AccountMenuItems
                    sessionUser={sessionUser}
                    showSubscriptionLink={false}
                    showThemeToggle={themedDsNav}
                  />
                </Dropdown.Menu>
              </Dropdown>
            </>
          )}
        </nav>
        <div className="ds-nav-ds-name" translate="no">
          <span>Extended CE</span>
        </div>
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
