import ReactDOM from 'react-dom/client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useThemedPage from '@/shared/hooks/use-themed-page'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import CookieBanner from '@/shared/components/cookie-banner'
import SystemMessages from '@/shared/components/system-messages'
import { DsNavPageSwitcher } from '../../../../../modules/ce-ui/frontend/js/ds-nav-page-switcher'
import { SidebarLowerSection } from '@/shared/components/sidebar/sidebar-lower-section'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import overleafLogoDark from '@/shared/svgs/overleaf-a-ds-solution-mallard-dark.svg'
import getMeta from '@/utils/meta'
import TemplateBundles from '../features/template-bundles/template-bundles'

function TemplateAdminChrome() {
  const { t } = useTranslation()
  useThemedPage()
  const activeOverallTheme = useActiveOverallTheme()
  const navbarProps = getMeta('ol-navbar') || {}
  const footerProps = getMeta('ol-footer') || {}
  return (
    <div className="project-ds-nav-page website-redesign">
      <SystemMessages />
      <DefaultNavbar
        {...navbarProps}
        overleafLogo={activeOverallTheme === 'dark' ? overleafLogoDark : overleafLogo}
      />
      <div className="project-list-wrapper">
        {/* R8 (2026-08-29): same left page-switcher nav as /templates */}
        <div className="project-list-sidebar-wrapper-react d-none d-md-flex">
          <DsNavPageSwitcher activePage="templates" showLogo={false} />
          <hr className="ds-nav-page-switcher-divider" />
          <nav className="flex-grow flex-shrink" aria-hidden="true" />
          <div className="ds-nav-sidebar-lower">
            <SidebarLowerSection showThemeToggle />
          </div>
        </div>
        <div className="project-ds-nav-content-and-messages">
          <div className="project-ds-nav-content">
            <div className="project-ds-nav-main">
              <main id="main-content" className="content content-page">
                <div className="container">
                  <h1 className="h2" style={{ fontWeight: 700, marginBottom: '8px' }}>
                    {t('Manage template gallery')}
                  </h1>
                  <p className="gallery-summary" style={{ marginBottom: '16px' }}>
                    {t('Save templates as bundles, or import them from a file or a URL. Only users with the template gallery admin role see this page.')}
                  </p>
                  <TemplateBundles />
                </div>
              </main>
              <Footer {...footerProps} />
            </div>
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}

function TemplateAdminPage() {
  const { isReady } = useWaitForI18n()
  if (!isReady) return null
  return (
    <SplitTestProvider>
      <UserSettingsProvider>
        <TemplateAdminChrome />
      </UserSettingsProvider>
    </SplitTestProvider>
  )
}

const element = document.getElementById('template-admin-root')
if (element) {
  const root = ReactDOM.createRoot(element)
  root.render(<TemplateAdminPage />)
}
