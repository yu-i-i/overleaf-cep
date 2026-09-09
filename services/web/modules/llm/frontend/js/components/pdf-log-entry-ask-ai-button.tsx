import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { useLLMChat } from '../hooks/use-llm-chat'
import { useLLMPrompts } from '../hooks/use-llm-prompts'

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
    // overleaf-lab: admin-editable prompts. Called unconditionally at the top so
    // the rules of hooks hold. Only the trailing instruction block is overridable;
    // when absent the hardcoded block is used as the fallback.
    const { prompts } = useLLMPrompts()

    const handleAskAI = useCallback(async () => {
        if (!logEntry) return
        try {
            // overleaf-lab: fetch a few source lines around the error line so the
            // model sees the actual code, not just the log. Best-effort: on any
            // failure we send the error without the snippet.
            let sourceSnippet = ''
            if (logEntry.file && logEntry.line) {
                try {
                    const projectId = getMeta('ol-project_id')
                    const params = new URLSearchParams({
                        file: String(logEntry.file),
                        line: String(logEntry.line),
                    })
                    const resp = await fetch(
                        `/project/${projectId}/llm/source-context?${params.toString()}`,
                        { credentials: 'same-origin' }
                    )
                    const json = await resp.json()
                    if (json?.ok && json.snippet) {
                        sourceSnippet = json.snippet
                    }
                } catch {
                    // ignore, proceed without source context
                }
            }

            const errorMessage = formatErrorForLLM(
                logEntry,
                sourceSnippet,
                prompts?.errorPrompt
            )

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
    }, [logEntry, prompts?.errorPrompt])

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

function formatErrorForLLM(
    logEntry: LogEntry,
    sourceSnippet?: string,
    errorPrompt?: string
): string {
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

    // overleaf-lab: include the source lines around the error (the > line is the
    // one the compiler flagged) so the model can point to and fix the actual code.
    if (sourceSnippet) {
        parts.push(
            '',
            '**Source around the error (the line marked with > is where the compiler reported it):**',
            '```latex',
            sourceSnippet,
            '```',
            ''
        )
    }

    if (logEntry.raw && logEntry.raw !== logEntry.message) {
        parts.push('', '**Full Error Details:**', '```', logEntry.raw, '```', '')
    }

    // overleaf-lab: the trailing instruction block is admin-overridable. Use the
    // admin errorPrompt when it is a non-empty string, else the hardcoded block
    // (kept verbatim) as the fallback.
    if (typeof errorPrompt === 'string' && errorPrompt.trim() !== '') {
        parts.push(errorPrompt)
    } else {
        parts.push(
            '**Please help me:**',
            "1. Explain what this error means in simple terms",
            "2. Show me exactly what's wrong in my code",
            '3. Provide the corrected code',
            '4. Explain how to avoid this error in the future'
        )
    }

    return parts.join('\n')
}

export default memo(PdfLogEntryAskAIButton)
