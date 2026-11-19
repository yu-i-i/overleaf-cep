import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import { useLLMChat } from '../hooks/use-llm-chat'
import LLMChatResponse from './llm-chat-response'
// プロジェクト TeX 自動参照（2026-11-13 の運用者要望）: 編集中ファイルのパスを
// chat リクエストに添えるため、生のコンテキストを安全に読む（未提供でも落ちない）。
import { EditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { FileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
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
  const messagesElement = useRef<HTMLDivElement>(null)
  const followMessages = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    rerunLastMessage,
    clearMessages,
    canRerun,
    modelsLoaded,
    hasModels,
  } = useLLMChat()

  useEffect(() => {
    const element = messagesElement.current
    if (element && followMessages.current)
      element.scrollTop = element.scrollHeight
  }, [messages, isLoading])

  const [inputValue, setInputValue] = useState('')
  const [includeEditor, setIncludeEditor] = useState(true)

  // ---- プロジェクト TeX 自動参照（2026-11-13 の運用者要望） -----------------
  // 編集中ファイルの相対パスを自動参照の先頭に置くため、編集中ドキュメントと
  // ファイルパス解決のコンテキストを生のまま読む（プロバイダー外では undefined）。
  // ※ ON/OFF は LLM 設定画面側（User.llmChatAutoContext）で管理するため、
  //   チャット画面にはスイッチを置かない（2026-11-13 の要望）。
  const openDoc = React.useContext(EditorOpenDocContext)
  const filePathContext = React.useContext(FileTreePathContext)
  const currentFile =
    openDoc?.currentDocumentId && filePathContext
      ? filePathContext.pathInFolder(String(openDoc.currentDocumentId)) ||
        undefined
      : undefined

  // Close chat panel if models become unavailable (only when controlled externally)
  useEffect(() => {
    if (modelsLoaded && !hasModels && isOpen === true && setIsOpen) {
      setIsOpen(false)
    }
  }, [modelsLoaded, hasModels, isOpen, setIsOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() && !isLoading) {
      // 自動参照: 編集中ファイルのパスを添えて送信する（ON/OFF はサーバーの
      // ユーザー設定。画面側のスイッチは設定画面へ移動済み）。
      followMessages.current = true
      sendMessage(inputValue, undefined, { currentFile, includeEditor })
      setInputValue('')
    }
  }

  const handleStop = () => {
    stopGeneration()
  }

  const handleRerun = () => {
    rerunLastMessage()
  }

  const [armedClear, setArmedClear] = useState(false)
  const armedTimer = useRef<number | null>(null)
  // clear the disarm timer on unmount (no setState-after-unmount)
  useEffect(
    () => () => {
      if (armedTimer.current) window.clearTimeout(armedTimer.current)
    },
    []
  )
  const armClear = () => {
    setArmedClear(true)
    if (armedTimer.current) window.clearTimeout(armedTimer.current)
    armedTimer.current = window.setTimeout(() => setArmedClear(false), 3000)
  }
  const handleClear = () => {
    if (!armedClear) {
      armClear()
      return
    }
    if (armedTimer.current) window.clearTimeout(armedTimer.current)
    setArmedClear(false)
    clearMessages()
  }

  if (modelsLoaded && !hasModels) {
    return null
  }

  if (isOpen === false) {
    return null
  }

  const displayMessages = messages.filter(m => m.role !== 'system')

  return (
    <aside className="chat" aria-label={t('ai_assistant', 'AI Assistant')}>
      <div className="llm-chat-container">
        {/* overleaf-lab (owner request 2026-08-26): the per-pane model picker is
                    gone — the ONLY selection entry point is File → "Select LLM Model".
                    The chat keeps using the shared (user-scoped) selection, synced
                    inside use-llm-chat via the LLM_MODEL_CHANGED_EVENT bridge. */}
        <div className="llm-chat-header">
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
                className={`llm-action-button${armedClear ? ' llm-action-button-armed' : ''}`}
                title={
                  armedClear
                    ? t(
                        'llm_chat_confirm_clear',
                        'Click again to clear the conversation'
                      )
                    : t('clear_conversation', 'Clear conversation')
                }
                aria-label={
                  armedClear
                    ? t(
                        'llm_chat_confirm_clear',
                        'Click again to clear the conversation'
                      )
                    : t('clear_conversation', 'Clear conversation')
                }
              >
                {armedClear ? (
                  <span className="llm-action-button-text">
                    {t('clear_confirm', 'Clear all?')}
                  </span>
                ) : (
                  <MaterialIcon type="delete" />
                )}
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
                {[
                  '選択した文章を学術的な表現に改善して',
                  'このファイルのLaTeXの問題を見つけて修正案を出して',
                  'このプロジェクトの構成を説明して',
                ].map(prompt => (
                  <li key={prompt}>
                    <button
                      type="button"
                      onClick={() => {
                        setInputValue(prompt)
                        inputRef.current?.focus()
                      }}
                    >
                      {prompt}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div
            className="llm-chat-messages"
            ref={messagesElement}
            onScroll={e => {
              const element = e.currentTarget
              followMessages.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                80
            }}
          >
            {displayMessages.map((msg, idx) => (
              <div key={idx} className={`llm-message llm-message-${msg.role}`}>
                <div className="message-container">
                  <LLMChatResponse content={msg.content} />
                  {msg.contextWarning && (
                    <div role="status" className="llm-context-status">
                      {msg.contextWarning}
                    </div>
                  )}
                  {/* 自動参照で使ったファイルの表示（2026-11-13）。 */}
                  {msg.role === 'assistant' &&
                    Array.isArray(msg.refs) &&
                    msg.refs.length > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          opacity: 0.65,
                          marginTop: 2,
                          padding: '0 2px',
                        }}
                      >
                        参照（抜粋の場合あり）:{' '}
                        {msg.refs.slice(0, 8).join(', ')}
                        {msg.refs.length > 8
                          ? ` …計 ${msg.refs.length} ファイル`
                          : ''}
                      </div>
                    )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="llm-message llm-message-assistant">
                <div className="message-container">
                  <div className="llm-message-loading">
                    <MaterialIcon type="smart_toy" className="loading-icon" />
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

        <div className="llm-context-status">
          <label>
            <input
              type="checkbox"
              checked={includeEditor}
              onChange={e => setIncludeEditor(e.target.checked)}
              disabled={isLoading}
            />
            編集中の本文・選択範囲を添付（ソースエディター使用時）
          </label>
          {currentFile && <span>編集中: {currentFile}</span>}
          <span>
            プロジェクトの自動参照はLLM設定に従います。変更案は確認して適用できます。
          </span>
        </div>
        {/* AI assistant input */}
        <form className="llm-chat-input-form" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            id="llm-chat-input"
            className="llm-chat-textarea"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              // Enter で送信。ただし日本語 IME 変換確定の Enter では
              // 送信しない（変換中は IME 側に Enter を渡す）。
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault()
                handleSubmit(e as any)
              }
            }}
            placeholder={t('ask_about_latex_placeholder', 'Ask about LaTeX...')}
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
