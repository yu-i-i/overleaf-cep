import { useTranslation } from 'react-i18next'
import {
  OLDropdown,
  OLDropdownMenu,
  OLDropdownItem,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import { useUserListContext } from '../context/user-list-context'

const OPTIONS = [20, 40, 80]

export default function UserListSummary() {
  const {
    visibleUsers,
    hiddenUsersCount,
    usersPerPage,
    setUsersPerPage,
  } = useUserListContext()
  const { t } = useTranslation()

  return (
    <div className="text-center">
        <span aria-live="polite">
          {t('showing_x_out_of_n_users', {
            x: visibleUsers.length,
            n: visibleUsers.length + hiddenUsersCount,
          })}
        </span>

        <span className="mx-2">·</span>

        <span className="d-inline-flex gap-1">
          <OLDropdown>

            <OLDropdownToggle
              as="span"
              className="entries-per-page-toggle"
            >
              {usersPerPage}
            </OLDropdownToggle>

            <OLDropdownMenu>
              {OPTIONS.map((value) => (
                <OLDropdownItem
                  key={value}
                  active={value === usersPerPage}
                  onClick={() => setUsersPerPage(value)}
                >
                  {value}
                </OLDropdownItem>
              ))}
            </OLDropdownMenu>

          </OLDropdown>

          <span>{t('per_page')}</span>
        </span>
    </div>
  )
}
