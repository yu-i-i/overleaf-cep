import { useTranslation } from 'react-i18next'
import NavLinkItem from '@/shared/components/navbar/nav-link-item'
import { useSendProjectListMB } from '@/features/project-list/components/project-list-events'
import getMeta from '@/utils/meta'

export default function LoggedOutItems({
  showSignUpLink,
}: {
  showSignUpLink: boolean
}) {
  const { t } = useTranslation()
  const sendMB = useSendProjectListMB()
  const { templatesEnabled } = getMeta('ol-ExposedSettings')

  return (
    <>
      {templatesEnabled && (
        <NavLinkItem href="/templates" className="nav-item-templates">
          {t('templates')}
        </NavLinkItem>
      )}
      {showSignUpLink ? (
        <NavLinkItem
          href="/register"
          className="primary nav-account-item"
          onClick={() => {
            sendMB('menu-click', { item: 'register', location: 'top-menu' })
          }}
        >
          {t('sign_up')}
        </NavLinkItem>
      ) : null}
      <NavLinkItem
        href="/login"
        className="nav-account-item"
        onClick={() => {
          sendMB('menu-click', { item: 'login', location: 'top-menu' })
        }}
      >
        {t('log_in')}
      </NavLinkItem>
    </>
  )
}
