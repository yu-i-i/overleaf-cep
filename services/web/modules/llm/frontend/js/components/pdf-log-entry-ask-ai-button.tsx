import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { useLLMChat } from '../hooks/use-llm-chat'

interface LogEntry {
    key?: string
    level: string
    message?: string
    content?: string
    file?: string
    line?: number
    raw?: string
}

interface AskAIButtonProps {
    logEntry?: LogEntry
    id?: string
}

function PdfLogEntryAskAIButton({ logEntry }: AskAIButtonProps) {
    const { t } = useTranslation()
    const { modelsLoaded, hasModels } = useLLMChat()

    const handleAskAI = useCallback(async () => {
        if (!logEntry) return
        try {
            const errorMessage = formatErrorForLLM(logEntry)

            // Open the LLM chat rail tab first
            window.dispatchEvent(
                new CustomEvent('ui:select-rail-tab', {
                    detail: { tab: 'llm-chat', open: true },
                })
            )

            // Small delay to let the rail panel mount and the hook register its listener
            setTimeout(() => {
                window.dispatchEvent(
                    new CustomEvent('llm-chat-send-message', {
                        detail: { message: errorMessage },
                    })
                )
            }, 150)
        } catch (err) {
            console.error('[LLM] Failed to send error to AI:', err)
        }
    }, [logEntry])

    // logEntry may be undefined in certain contexts; only show for errors
    if (!logEntry || logEntry.level !== 'error') {
        return null
    }

    if (!modelsLoaded || !hasModels) {
        return null
    }

    return (
        <OLTooltip
            id={`ask-ai-${logEntry.key}`}
            description={t('ask_ai_about_error', 'Ask AI about this error')}
            overlayProps={{ placement: 'bottom' }}
        >
            <OLIconButton
                onClick={handleAskAI}
                variant="ghost"
                icon="smart_toy"
                accessibilityLabel={t(
                    'ask_ai_about_error',
                    'Ask AI about this error'
                )}
            />
        </OLTooltip>
    )
}

function formatErrorForLLM(logEntry: LogEntry): string {
    const parts = [
        '🔴 **LaTeX Compilation Error**',
        '',
        '**Error Message:**',
        logEntry.message || logEntry.content || 'Unknown error',
        '',
    ]

    if (logEntry.file) {
        parts.push(`**File:** \`${logEntry.file}\``)
    }

    if (logEntry.line) {
        parts.push(`**Line:** ${logEntry.line}`)
    }

    if (logEntry.raw && logEntry.raw !== logEntry.message) {
        parts.push('', '**Full Error Details:**', '```', logEntry.raw, '```', '')
    }

    parts.push(
        '**Please help me:**',
        "1. Explain what this error means in simple terms",
        "2. Show me exactly what's wrong in my code",
        '3. Provide the corrected code',
        '4. Explain how to avoid this error in the future'
    )

    return parts.join('\n')
}

export default memo(PdfLogEntryAskAIButton)
