import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import { useLLMChat } from '../hooks/use-llm-chat'
import { marked } from 'marked'
import '../../stylesheets/llm-chat.scss'

interface LLMChatPaneProps {
    isOpen?: boolean
    setIsOpen?: (open: boolean) => void
}

const LLMChatPane = React.memo(function LLMChatPane({
    isOpen,
    setIsOpen,
}: LLMChatPaneProps) {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const {
        messages,
        isLoading,
        sendMessage,
        stopGeneration,
        rerunLastMessage,
        clearMessages,
        models,
        selectedModel,
        setSelectedModel,
        canRerun,
        modelsLoaded,
        hasModels,
    } = useLLMChat()

    const [inputValue, setInputValue] = useState('')

    // Close chat panel if models become unavailable (only when controlled externally)
    useEffect(() => {
        if (modelsLoaded && !hasModels && isOpen === true && setIsOpen) {
            setIsOpen(false)
        }
    }, [modelsLoaded, hasModels, isOpen, setIsOpen])

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (inputValue.trim() && !isLoading) {
            sendMessage(inputValue)
            setInputValue('')
        }
    }

    const handleStop = () => {
        stopGeneration()
    }

    const handleRerun = () => {
        rerunLastMessage()
    }

    const handleClear = () => {
        if (confirm(t('clear_conversation_confirm', 'Clear conversation?'))) {
            clearMessages()
        }
    }

    if (modelsLoaded && !hasModels) {
        return null
    }

    if (isOpen === false) {
        return null
    }

    const displayMessages = messages.filter(m => m.role !== 'system')
    const showModelSelector = models.length > 0

    return (
        <aside className="chat" aria-label={t('ai_assistant', 'AI Assistant')}>
            <div className="llm-chat-container">
                {/* Header with Model Selector and Action Buttons */}
                <div className="llm-chat-header">
                    {showModelSelector && (
                        <div className="llm-model-selector">
                            <label htmlFor="model-select">
                                {t('model_label', 'Model')}
                            </label>
                            <select
                                id="model-select"
                                value={selectedModel}
                                onChange={e => setSelectedModel(e.target.value)}
                                disabled={isLoading}
                                aria-label={t('model_label', 'Model')}
                            >
                                {models.map(model => (
                                    <option key={model.id} value={model.id}>
                                        {model.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="llm-action-buttons">
                        {canRerun && !isLoading && (
                            <button
                                type="button"
                                onClick={handleRerun}
                                className="llm-action-button"
                                title={t('re_run_last_question', 'Re-run last question')}
                                aria-label={t('re_run_last_question', 'Re-run last question')}
                            >
                                <MaterialIcon type="refresh" />
                            </button>
                        )}

                        {displayMessages.length > 0 && !isLoading && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="llm-action-button"
                                title={t('clear_conversation', 'Clear conversation')}
                                aria-label={t('clear_conversation', 'Clear conversation')}
                            >
                                <MaterialIcon type="delete" />
                            </button>
                        )}
                    </div>
                </div>

                {displayMessages.length === 0 ? (
                    <div className="llm-chat-welcome">
                        <MaterialIcon type="smart_toy" className="llm-welcome-icon" />
                        <h3>{t('latex_ai_assistant', 'LaTeX AI Assistant')}</h3>
                        <p>
                            {t(
                                'ai_assistant_description',
                                'Ask questions about LaTeX, get help with errors, and more.'
                            )}
                        </p>
                        <div className="llm-suggestions">
                            <p className="llm-suggestions-title">
                                {t('try_asking', 'Try asking')}:
                            </p>
                            <ul>
                                <li>"How do I create a table?"</li>
                                <li>"Help me fix this equation"</li>
                                <li>"How to add bibliography?"</li>
                                <li>"Explain this LaTeX command"</li>
                            </ul>
                        </div>
                    </div>
                ) : (
                    <div className="llm-chat-messages">
                        {displayMessages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`llm-message llm-message-${msg.role}`}
                            >
                                <div className="message-container">
                                    <div
                                        className="message-content"
                                        // Content comes only from the configured LLM API — not from other users
                                        // eslint-disable-next-line react/no-danger
                                        dangerouslySetInnerHTML={{
                                            __html: marked.parse(msg.content) as string,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="llm-message llm-message-assistant">
                                <div className="message-container">
                                    <div className="llm-message-loading">
                                        <MaterialIcon
                                            type="smart_toy"
                                            className="loading-icon"
                                        />
                                        <span>{t('thinking', 'Thinking...')}</span>
                                        <button
                                            type="button"
                                            onClick={handleStop}
                                            className="llm-stop-button"
                                            title={t('stop_generation', 'Stop')}
                                            aria-label={t('stop_generation', 'Stop')}
                                        >
                                            <MaterialIcon type="stop" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* AI assistant input */}
                <form className="llm-chat-input-form" onSubmit={handleSubmit}>
                    <textarea
                        ref={inputRef}
                        id="llm-chat-input"
                        className="llm-chat-textarea"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSubmit(e as any)
                            }
                        }}
                        placeholder={t(
                            'ask_about_latex_placeholder',
                            'Ask about LaTeX...'
                        )}
                        disabled={isLoading}
                        rows={1}
                        aria-label={t('ai_assistant_input', 'AI assistant input')}
                    />
                    <button
                        type="submit"
                        className="llm-chat-send-button"
                        disabled={isLoading || !inputValue.trim()}
                        aria-label={t('send', 'Send')}
                    >
                        <MaterialIcon type="send" />
                    </button>
                </form>
            </div>
        </aside>
    )
})

export default LLMChatPane
