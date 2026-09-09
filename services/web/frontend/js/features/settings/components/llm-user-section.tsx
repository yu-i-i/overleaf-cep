// overleaf-lab: PR item 2 — a visible AI-assistant section on the Account
// Settings page that points at the LLM settings page. The module's React
// component itself stays in the module's own webpack entry
// (modules/*/frontend are built as separate entries — importing module React
// into the core bundle would risk dual React instances), so this section is a
// safe single-bundle card that gives the settings page the discoverability the
// review asked for.
import React from 'react'
import { useTranslation } from 'react-i18next'

function LLMUserSection() {
    const { t } = useTranslation()
    return (
        <div style={{ marginTop: '0.5rem' }}>
            <h2>{t('llm_section_title', 'AI assistant')}</h2>
            <p style={{ color: '#6c757d' }}>
                {t(
                    'llm_section_help',
                    'Use the AI chat, selection actions and optional personal LLM connection for this project.'
                )}
            </p>
            <a
                href="/user/llm-settings"
                className="btn btn-secondary"
                aria-label={t('llm_section_open', 'Open AI assistant settings')}
            >
                {t('llm_section_open', 'Open AI assistant settings')}
            </a>
        </div>
    )
}

export default LLMUserSection
