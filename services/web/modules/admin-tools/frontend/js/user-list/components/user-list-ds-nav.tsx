import { useUserListContext } from '../context/user-list-context'
import { useTranslation } from 'react-i18next'
import CreateAccountButton from './create-account-button'
import UserListTable from './table/user-list-table'
import SearchForm from './search-form'
import UsersDropdown from './dropdown/users-dropdown'
import SortByDropdown from './dropdown/sort-by-dropdown'
import UserTools from './table/user-tools/user-tools'
import UserListTitle from './title/user-list-title'
import CountUsers from './count-users'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import { TableContainer } from '@/shared/components/table'
import DashApiError from '@/features/project-list/components/dash-api-error'
import getMeta from '@/utils/meta'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import SidebarDsNav from './sidebar/sidebar-ds-nav'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import CookieBanner from '@/shared/components/cookie-banner'
import Pagination from '@/shared/components/pagination-cep'
import UserListSummary from './user-list-summary'

export function UserListDsNav() {
  const navbarProps = getMeta('ol-navbar')
  const footerProps = getMeta('ol-footer')

  const { t } = useTranslation()
  const {
    error,
    searchText,
    setSearchText,
    selectedUsers,
    filter,
    currentPage,
    setCurrentPage,
    totalPages,
  } = useUserListContext()

  const tableTopArea = (
    <div className="pt-2 pb-3 d-md-none d-flex gap-2">
      <CreateAccountButton
        id="create-account-button-users-table"
      />
      <SearchForm
        inputValue={searchText}
        setInputValue={setSearchText}
        className="overflow-hidden flex-grow-1"
      />
    </div>
  )

  return (
    <div className="user-ds-nav-page website-redesign">
      <DefaultNavbar
        {...navbarProps}
        overleafLogo={overleafLogo}
        showCloseIcon
      />
      <div className="user-list-wrapper">
        <SidebarDsNav />
        <div className="user-ds-nav-content-and-messages">
          <div className="user-ds-nav-content">
            <div className="user-ds-nav-main">
              {error ? <DashApiError /> : ''}
              <main aria-labelledby="main-content">
                <div className="user-list-header-row">
                  <UserListTitle
                    filter={filter}
                    className="text-truncate d-none d-md-block"
                  />
                  <div className="user-tools">
                    <div className="d-none d-md-block">
                      {selectedUsers.length !== 0 && <UserTools />}
                    </div>
                  </div>
                </div>
                <div className="user-ds-nav-user-list">
                  <OLRow className="d-none d-md-block">
                    <OLCol lg={7}>
                      <SearchForm
                        inputValue={searchText}
                        setInputValue={setSearchText}
                      />
                    </OLCol>
                  </OLRow>
                  <div className="mt-1 d-md-none">
                    <div
                      role="toolbar"
                      className="users-toolbar"
                      aria-label={t('users')}
                    >
                      <UsersDropdown />
                      <SortByDropdown />
                    </div>
                  </div>
                  <div className="mt-3">
                    <TableContainer bordered>
                      {tableTopArea}
                      <UserListTable />
                    </TableContainer>
                  </div>
                  <div className="mt-3">
                    <UserListSummary />
                  </div>
                  <div className="mt-3">
                    <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
                  </div>
                </div>
              </main>
            </div>
            <Footer {...footerProps} />
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}
