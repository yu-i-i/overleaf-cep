import React from 'react'
import { useTranslation } from 'react-i18next'
import LLMSettingsSection from './llm-settings-section'
import LLMUsageMeter from './llm-usage-meter' // overleaf-lab (usage meter)
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import { UserProvider } from '@/shared/context/user-context'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useScrollToIdOnLoad from '@/shared/hooks/use-scroll-to-id-on-load'
// overleaf-lab: BYO table/editor styles were only imported by the admin page,
// so this page shipped with zero module CSS — import the shared stylesheet here too.
import '../../stylesheets/llm-settings.scss'
// overleaf-lab: shared upstream-AI design tokens (--wf-*) used by the settings chrome
import '../../stylesheets/llm-ui.scss'

export default function LLMSettingsPage() {
  const { t } = useTranslation()
  const { isReady } = useWaitForI18n()
  useScrollToIdOnLoad()

  return (
    <div className="container">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          {isReady ? (
            <UserProvider>
              <OLPageContentCard>
                <div className="page-header">
                  <h1>{t('llm_settings', 'LLM Settings')}</h1>
                </div>
                <div>
                  <LLMSettingsSection />
                </div>
                {/* overleaf-lab (usage meter, 2026-08-28, owner request): my own token
                                    usage — both the site lane and my personal BYO rows count. */}
                <div className="ol-llm-admin-settings__mt-xl">
                  <h2>{t('llm_usage', 'Usage')}</h2>
                  <LLMUsageMeter scope="user" />
                </div>
              </OLPageContentCard>
            </UserProvider>
          ) : null}
        </OLCol>
      </OLRow>
    </div>
  )
}
