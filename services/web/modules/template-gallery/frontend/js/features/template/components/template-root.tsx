import { useTranslation } from 'react-i18next'
import React from 'react'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useThemedPage from '@/shared/hooks/use-themed-page'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { UserSettingsProvider } from '@/shared/context/user-settings-context'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import getMeta from '@/utils/meta'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import CookieBanner from '@/shared/components/cookie-banner'
import SystemMessages from '@/shared/components/system-messages'
import { DsNavPageSwitcher } from '../../../../../../../modules/ce-ui/frontend/js/ds-nav-page-switcher'
import { SidebarLowerSection } from '@/shared/components/sidebar/sidebar-lower-section'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import overleafLogo from '@/shared/svgs/overleaf-a-ds-solution-mallard.svg'
import overleafLogoDark from '@/shared/svgs/overleaf-a-ds-solution-mallard-dark.svg'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import TemplateDetails from './template-details'
import TemplatePreview from './template-preview'
import { useTemplateContext, TemplateProvider } from '../context/template-context'

/**
 * /templates/{slug} root — same design-system chrome as /library, /project
 * and the /templates gallery (ds-nav page switcher + account/theme lower
 * section), following the user's overall light/dark theme.
 */
function TemplateRoot() {
  const { isReady } = useWaitForI18n()
  if (!isReady) {
    return null
  }
  return (
    <SplitTestProvider>
      <UserSettingsProvider>
        <TemplateChrome />
      </UserSettingsProvider>
    </SplitTestProvider>
  )
}

function TemplateChrome() {
  const activeOverallTheme = useActiveOverallTheme()
  useThemedPage()
  const navbarProps = getMeta('ol-navbar')
  const footerProps = getMeta('ol-footer')

  return (
    <div className="project-ds-nav-page website-redesign">
      <SystemMessages />
      <DefaultNavbar
        {...navbarProps}
        overleafLogo={
          activeOverallTheme === 'dark' ? overleafLogoDark : overleafLogo
        }
        showCloseIcon
      />
      <div className="project-list-wrapper">
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
              <TemplateProvider>
                <TemplatePageContent />
              </TemplateProvider>
            </div>
            <Footer {...footerProps} />
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}

function TemplatePageContent() {
  const { t } = useTranslation()
  const { template } = useTemplateContext()
  const { templateLinks } = getMeta('ol-ExposedSettings') || []
  const categoryName = templateLinks?.find(link => link.url === template.category)?.name

  return (
    <main id="main-content" className="gallery content content-page">
      <div className="container">
        <OLRow className="previous-page-link-container">
          <OLCol lg={6}>
            <a className="previous-page-link" href="/templates/all">
              <i className="material-symbols material-symbols-rounded" aria-hidden="true">arrow_left_alt</i>
              {t('all_templates')}
            </a>
              {categoryName && template.category !== '/templates/all' && (
                <>
                  <span className="mx-2">/</span>
                  <a className="previous-page-link" href={template.category}>
                    {categoryName}
                  </a>
                </>
              )}
          </OLCol>
        </OLRow>
        <OLRow>
          <OLCol className="template-item-left-section" md={6}>
            <TemplateDetails />
          </OLCol>
          <OLCol className="template-item-right-section" md={6}>
            <TemplatePreview />
          </OLCol>
        </OLRow>
      </div>
    </main>
  )
}

export default withErrorBoundary(TemplateRoot, GenericErrorBoundaryFallback)
