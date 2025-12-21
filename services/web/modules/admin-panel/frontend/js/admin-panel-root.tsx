import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import { AdminPanelProvider, useAdminPanelContext } from './admin-panel-context.tsx'
import { UserListProvider } from './user-list/context/user-list-context'
import UserListRoot from './user-list/components/user-list-root'
import { ProjectListProvider } from './project-list/context/project-list-context'
import ProjectListRoot from './project-list/components/project-list-root'

function AdminPanelPageSelector() {
  const { page } = useAdminPanelContext()

  if (page.type === 'projects') {
    return (
      <ProjectListProvider userId={page.user.id}>
        <ProjectListRoot />
      </ProjectListProvider>
    )
  }
  return <UserListRoot />
}

function AdminPanelRoot() {
  const { isReady } = useWaitForI18n()

  if (!isReady) return null

  return (
    <SplitTestProvider>
      <UserSettingsProvider>
        <AdminPanelProvider>
          <UserListProvider>
            <AdminPanelPageSelector />
          </UserListProvider>
        </AdminPanelProvider>
      </UserSettingsProvider>
    </SplitTestProvider>
  )
}

export default withErrorBoundary(AdminPanelRoot, () => (
  <GenericErrorBoundaryFallback />
))

