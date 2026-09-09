import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import SiteSettingsPage from './components/site-settings-page'

function SiteSettingsRoot() {
  const { isReady } = useWaitForI18n()

  if (!isReady) return null

  return (
    <SplitTestProvider>
      <UserSettingsProvider>
        <SiteSettingsPage />
      </UserSettingsProvider>
    </SplitTestProvider>
  )
}

export default withErrorBoundary(SiteSettingsRoot, () => (
  <GenericErrorBoundaryFallback />
))
