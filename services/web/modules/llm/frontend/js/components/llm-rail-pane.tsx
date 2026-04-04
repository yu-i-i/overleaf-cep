import React from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import LLMChatPane from './llm-chat-pane'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'

function LLMRailPane() {
    const { t } = useTranslation()

    return (
        <div className="llm-rail-panel">
            <RailPanelHeader title={t('ai_assistant', 'AI Assistant')} />
            <LLMChatPane />
        </div>
    )
}

const llmRailEntry: RailElement = {
    key: 'llm-chat',
    icon: 'smart_toy',
    title: 'AI Assistant',
    component: <LLMRailPane />,
    hide: () => !(getMeta('ol-ExposedSettings') as any)?.llmEnabled,
}

export default llmRailEntry
