import React from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import LLMSettingsSection from './llm-settings-section'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import { UserProvider } from '@/shared/context/user-context'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useScrollToIdOnLoad from '@/shared/hooks/use-scroll-to-id-on-load'

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
                            </OLPageContentCard>
                        </UserProvider>
                    ) : null}
                </OLCol>
            </OLRow>
        </div>
    )
}
