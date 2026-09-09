import { TemplateGalleryProvider } from '../context/template-gallery-context'
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
import GalleryHeaderTagged from './gallery-header-tagged'
import GalleryHeaderAll from './gallery-header-all'
import TemplateGallery from './template-gallery'
import GallerySearchSortHeader from './gallery-search-sort-header'
import GalleryPopularTags from './gallery-popular-tags'

/**
 * /templates root — same design-system chrome as /library + /project
 * (DefaultNavbar, left ds-nav page switcher with Library/Projects/Templates,
 * shared lower section with account + theme toggle, footer, cookie banner).
 * The page follows the user's overall light/dark theme (useThemedPage)
 * and exposes the theme toggle via the account menu (ol-overallThemes).
 */
function TemplateGalleryRoot() {
  const { isReady } = useWaitForI18n()
  if (!isReady) {
    return null
  }
  return (
    <SplitTestProvider>
      <UserSettingsProvider>
        <TemplateGalleryChrome />
      </UserSettingsProvider>
    </SplitTestProvider>
  )
}

function TemplateGalleryChrome() {
  const { t } = useTranslation()
  const category = getMeta('ol-templateCategory')
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
              <TemplateGalleryProvider>
                <main id="main-content" aria-labelledby="main-content" className={`content content-page gallery ${category ? 'gallery-tagged' : ''}`}>
                <div className="container">
                  {category ? (
                    <>
                      <GalleryHeaderTagged category={category} />
                      <TemplateGallery />
                    </>
                  ) : (
                    <>
                      <GalleryHeaderAll />
                      <GalleryPopularTags />
                      <hr className="w-full border-muted mb-5" />
                      <div className="recent-docs">
                        <GallerySearchSortHeader />
                        <h2>{t('all_templates')}</h2>
                        <TemplateGallery />
                      </div>
                    </>
                  )}
                </div>
              </main>
              </TemplateGalleryProvider>
            </div>
            <Footer {...footerProps} />
          </div>
          <CookieBanner />
        </div>
      </div>
    </div>
  )
}

export default withErrorBoundary(TemplateGalleryRoot, GenericErrorBoundaryFallback)
