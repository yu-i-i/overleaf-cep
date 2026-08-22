import React from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import LLMSettingsSection from './llm-settings-section'
import LLMComplianceSettings from './llm-compliance-settings' // overleaf-lab (2026-08-27): user-scoped review rubrics
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
    const user = getMeta('ol-user') || {}

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
                                    <LLMSettingsSection initialSettings={user.llmSettings} />
                                </div>
                                {/* overleaf-lab (2026-08-27, owner request): the compliance
                                    review rubrics are USER-SCOPED and configured here, in
                                    every user's own LLM settings — the former global admin
                                    section is gone. */}
                                <div className="ol-llm-admin-settings__mt-xl">
                                    <h2>{t('compliance_review', 'Compliance Review')}</h2>
                                    <LLMComplianceSettings />
                                </div>
                            </OLPageContentCard>
                        </UserProvider>
                    ) : null}
                </OLCol>
            </OLRow>
        </div>
    )
}
