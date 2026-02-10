import { useTranslation } from 'react-i18next'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import { useUserListContext } from '../context/user-list-context'

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
      <p>
        <span aria-live="polite">
          {t('showing_x_out_of_n_users', {
            x: visibleUsers.length,
            n: visibleUsers.length + hiddenUsersCount,
          })}
        </span>
        <span className="mx-2">·</span>
        <span className="d-inline-flex gap-1">
          <OLFormSelect
            name="users_per_page"
            value={usersPerPage}
            onChange={(e) => setUsersPerPage(Number(e.target.value))}
            style={{
              width: 'auto',
              border: '1px solid #ccc',
              background: 'var(--green-10)',
              padding: '0 0.2rem',
              boxShadow: 'none',
              cursor: 'pointer',
            }}
          >
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={80}>80</option>
          </OLFormSelect>
          <span>
            {t('per_page')}
          </span>
        </span>
      </p>
    </div>
  )
}
