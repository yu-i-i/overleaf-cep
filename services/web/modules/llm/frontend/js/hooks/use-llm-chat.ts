import { useState, useCallback, useEffect, useRef } from 'react'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import {
  readSelectedModel,
  writeSelectedModel,
} from '../utils/llm-selected-model'
import { requestEditorSnapshot } from '../utils/llm-chat-edits'
import { LLM_MODEL_CHANGED_EVENT } from './use-llm-model-selection'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  // 自動参照（プロジェクト TeX）で使用したファイル一覧（表示用・任意）。
  contextWarning?: string
  localOnly?: boolean
  refs?: string[]
}

interface LLMModel {
  id: string
  name: string
  isDefault: boolean
  isPersonal?: boolean
  label?: string
  rowName?: string
}

interface LLMResponse {
  ok: boolean
  message?: string
  contextWarning?: string
  content?: string
  model?: string
  lane?: 'site' | 'user'
  refs?: string[]
}

// プロジェクト TeX 自動参照の送信オプション（2026-11-13 の運用者要望）。
export interface ChatExtras {
  // 編集中ファイルの相対パス（参照ブロックの先頭に冒頭を載せる）。
  includeEditor?: boolean
  currentFile?: string
  // false で自動参照をオフ（チェックボックスの OFF 状態）。
  projectContext?: boolean
}

export const useLLMChat = () => {
  const projectId = getMeta('ol-project_id')

  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<LLMModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [lastUserMessage, setLastUserMessage] = useState<string>('')
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelsError, setModelsError] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)

  // 自動参照の送信オプション（再実行で引き継ぐため ref 保持・2026-11-13）。
  const extrasRef = useRef<ChatExtras>({})

  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    async function fetchModels() {
      if (!projectId) {
        // overleaf-lab: nothing to do outside a project; models list stays empty.
        return
      }
      try {
        const data = await getJSON<{
          models: LLMModel[]
          userRows?: Array<{ id: string; name: string; models: LLMModel[] }>
        }>(`/project/${projectId}/llm/models`)

        const { llmAllowUserSettings } = getMeta('ol-ExposedSettings') || {}
        const siteModels: LLMModel[] = data.models || []
        // overleaf-lab: BYO rows are namespaced u:<rowId>:<model>; the
        // backend returns them grouped per provider row. Flatten into the
        // picker list while keeping the row name for grouping in the UI.
        const rowModels: LLMModel[] = []
        if (llmAllowUserSettings !== false) {
          for (const row of data.userRows || []) {
            for (const m of row.models || []) {
              rowModels.push({ ...m, rowName: row.name })
            }
          }
        }
        const modelsFromBackend = [...siteModels, ...rowModels]

        setModels(modelsFromBackend)
        setModelsError(false)

        const defaultModel =
          modelsFromBackend.find((m: LLMModel) => m.isDefault) ||
          modelsFromBackend[0]
        // overleaf-lab: restore the last selected model if it is still
        // available (remembers the choice and self-heals a stale/removed
        // id by falling back to the default). See utils/llm-selected-model.
        const stored = readSelectedModel(projectId)
        const restored =
          stored && modelsFromBackend.some((m: LLMModel) => m.id === stored)
            ? stored
            : defaultModel?.id || ''
        setSelectedModel(restored)
        setModelsLoaded(true)
      } catch (err) {
        // overleaf-lab: surface the failure through the UI state below instead
        // of a raw console call (ESLint no-console).
        void err
        setModels([])
        setSelectedModel('')
        setModelsError(true)
        // Don't set modelsLoaded=true on error so button remains visible
      }
    }

    fetchModels()
  }, [projectId])

  // overleaf-lab: persist the selected model so the selection toolbar ("Ask AI")
  // can reuse it. Runs for the initial default and every user change.
  useEffect(() => {
    // overleaf-lab: selection is remembered per project (falls back to the
    // global key outside project contexts).
    writeSelectedModel(selectedModel, projectId)
  }, [selectedModel, projectId])

  // overleaf-lab (owner request 2026-08-25): the "Select LLM Model" dialog
  // (and any other AI surface) can change the shared selection — keep the
  // chat's working model (sent with every request) in sync.
  useEffect(() => {
    const handler = (e: Event) => {
      const value = (e as CustomEvent).detail?.value
      if (typeof value === 'string') setSelectedModel(value)
    }
    window.addEventListener(LLM_MODEL_CHANGED_EVENT, handler)
    return () => window.removeEventListener(LLM_MODEL_CHANGED_EVENT, handler)
  }, [])

  const sendMessage = useCallback(
    async (
      userMessage: string,
      baseMessages?: Message[],
      extras?: ChatExtras
    ) => {
      if (abortControllerRef.current || !userMessage.trim()) return
      // 再実行（rerun）では extras を引き継ぐため ref にも保持する。
      const effectiveExtras: ChatExtras = extras ?? {
        includeEditor: extrasRef.current.includeEditor,
      }
      extrasRef.current = effectiveExtras
      const newMessages: Message[] = [
        ...(baseMessages || messagesRef.current),
        { role: 'user', content: userMessage },
      ]

      // F11: keep the ref in sync immediately so callers that raced a
      // setMessages (e.g. rerunLastMessage) can never observe a stale list.
      messagesRef.current = newMessages
      setMessages(newMessages)
      setIsLoading(true)
      setError(null)
      setLastUserMessage(userMessage)

      const controller = new AbortController()
      abortControllerRef.current = controller
      const editorContext =
        effectiveExtras.includeEditor === false
          ? undefined
          : requestEditorSnapshot()

      try {
        // overleaf-lab: swallowAbortError=false so a Stop press REJECTS the
        // request with AbortError (the default would leave it pending and
        // the UI would hang on "loading").
        const data: LLMResponse = await postJSON(
          '/project/' + projectId + '/llm/chat',
          {
            body: {
              // overleaf-lab (2026-08-26): no explicit model — the
              // backend resolves the user's profile selection, so
              // chat, ask-AI, review, generators and compile-fix all
              // run on exactly the user's chosen model.
              messages: newMessages
                .filter(m => !m.localOnly)
                .map(({ role, content }) => ({ role, content })),
              editorContext,
              // プロジェクト TeX 自動参照: 編集中ファイルと自動参照の
              // オン/オフを伝え、サーバー側が質問に合うファイルを拾う。
              currentFile:
                editorContext?.file || effectiveExtras.currentFile || undefined,
              projectContext: effectiveExtras.projectContext !== false,
            },
            signal: controller.signal,
            swallowAbortError: false,
          }
        )

        if (abortControllerRef.current !== controller) return
        if (!data || typeof data.content !== 'string') {
          throw new Error(
            (data && data.message) || 'Invalid response format from LLM API'
          )
        }

        const assistantMessage: Message = {
          role: 'assistant',
          content: data.content,
          contextWarning: data.contextWarning,
          // 自動参照で使ったファイル（「参照: …」表示用）。
          refs: Array.isArray(data.refs) ? data.refs : undefined,
        }

        messagesRef.current = [...newMessages, assistantMessage]
        setMessages(messagesRef.current)
      } catch (err: any) {
        if (abortControllerRef.current !== controller) return
        if (err.name === 'AbortError') {
          const abortMsg: Message = {
            role: 'assistant',
            content: '生成を停止しました。再実行できます。',
            localOnly: true,
          }
          messagesRef.current = [...newMessages, abortMsg]
          setMessages(messagesRef.current)
        } else {
          const errorMessage =
            err?.data?.message ||
            (err instanceof Error ? err.message : 'Unknown error')
          setError(errorMessage)

          const errorMsg: Message = {
            role: 'assistant',
            content: `リクエストに失敗しました: ${errorMessage}`,
            localOnly: true,
          }
          messagesRef.current = [...newMessages, errorMsg]
          setMessages(messagesRef.current)
        }
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false)
          abortControllerRef.current = null
        }
      }
    },
    [projectId]
  )

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }, [])

  const rerunLastMessage = useCallback(() => {
    if (!lastUserMessage || abortControllerRef.current) return

    const currentMessages = messagesRef.current
    let foundIndex = -1

    for (let i = currentMessages.length - 1; i >= 0; i--) {
      if (
        currentMessages[i].role === 'user' &&
        currentMessages[i].content === lastUserMessage
      ) {
        foundIndex = i
        break
      }
    }

    if (foundIndex === -1) {
      sendMessage(lastUserMessage)
      return
    }

    const messagesBeforeRerun = currentMessages.slice(0, foundIndex)
    setMessages(messagesBeforeRerun)

    sendMessage(lastUserMessage, messagesBeforeRerun, extrasRef.current)
  }, [lastUserMessage, sendMessage])

  const clearMessages = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    messagesRef.current = []
    extrasRef.current = {}
    setMessages([])
    setIsLoading(false)
    setError(null)
    setLastUserMessage('')
  }, [])

  useEffect(
    () => () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    },
    []
  )

  // Listen for messages from error log "Ask AI" buttons
  useEffect(() => {
    const handleSendMessage = (event: CustomEvent<{ message: string }>) => {
      sendMessage(event.detail.message)
    }

    window.addEventListener(
      'llm-chat-send-message',
      handleSendMessage as EventListener
    )

    return () => {
      window.removeEventListener(
        'llm-chat-send-message',
        handleSendMessage as EventListener
      )
    }
  }, [sendMessage])

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    stopGeneration,
    rerunLastMessage,
    clearMessages,
    models,
    selectedModel,
    setSelectedModel,
    canRerun: !!lastUserMessage,
    modelsLoaded,
    modelsError,
    hasModels: models.length > 0,
  }
}
