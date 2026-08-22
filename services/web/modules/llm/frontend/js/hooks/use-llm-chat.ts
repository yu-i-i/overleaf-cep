import { useState, useCallback, useEffect, useRef } from 'react'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import {
    readSelectedModel,
    writeSelectedModel,
} from '../utils/llm-selected-model'
import { LLM_MODEL_CHANGED_EVENT } from './use-llm-model-selection'

interface Message {
    role: 'system' | 'user' | 'assistant'
    content: string
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
    content?: string
    model?: string
    lane?: 'site' | 'user'
}

const SYSTEM_PROMPT = `You are an expert LaTeX debugging assistant and compiler error specialist.

**Your Primary Role - Error Debugging:**
- Analyze LaTeX compilation errors and warnings
- Identify syntax mistakes, missing packages, and structural issues
- Explain errors in beginner-friendly language
- Provide working fixes with clear explanations

**When a user sends a compilation error:**

1. **Quick Summary** (1-2 sentences)
   - What's wrong in plain English

2. **The Problem**
   - Explain the error clearly
   - Point to the exact issue in their code

3. **The Fix**
   - Show corrected code in \`\`\`latex blocks
   - Highlight what changed

4. **Why This Happened**
   - Brief explanation of the root cause
   - How to prevent it in future

**Error Analysis Guidelines:**
- The line marked with → is where the error occurred
- Look at surrounding context for clues
- Common issues: typos in commands, missing packages, unmatched braces
- Check for: \\begin without \\end, missing $, wrong package names

**Also Helpful With:**
- General LaTeX syntax and commands
- Document structure and formatting
- Mathematical typesetting
- Bibliography and citations

**Response Style:**
- Be concise and practical
- Use code blocks for all LaTeX examples
- Assume the user is learning LaTeX
- Focus on solving the immediate problem first

Remember: The user is likely frustrated. Be encouraging and clear!`

export const useLLMChat = () => {
    const projectId = getMeta('ol-project_id')

    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'system',
            content: SYSTEM_PROMPT,
        },
    ])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [models, setModels] = useState<LLMModel[]>([])
    const [selectedModel, setSelectedModel] = useState<string>('')
    const [lastUserMessage, setLastUserMessage] = useState<string>('')
    const [modelsLoaded, setModelsLoaded] = useState(false)
    const [modelsError, setModelsError] = useState(false)

    const abortControllerRef = useRef<AbortController | null>(null)

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
        async (userMessage: string, baseMessages?: Message[]) => {
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

            abortControllerRef.current = new AbortController()

            try {
                // overleaf-lab: swallowAbortError=false so a Stop press REJECTS the
                // request with AbortError (the default would leave it pending and
                // the UI would hang on "loading").
                const data: LLMResponse = await postJSON('/project/' + projectId + '/llm/chat', {
                    body: {
                        // overleaf-lab (2026-08-26): no explicit model — the
                        // backend resolves the user's profile selection, so
                        // chat, ask-AI, review, generators and compile-fix all
                        // run on exactly the user's chosen model.
                        messages: newMessages,
                    },
                    signal: abortControllerRef.current.signal,
                    swallowAbortError: false,
                })

                if (!data || typeof data.content !== 'string') {
                    throw new Error((data && data.message) || 'Invalid response format from LLM API')
                }

                const assistantMessage: Message = {
                    role: 'assistant',
                    content: data.content,
                }

                setMessages([...newMessages, assistantMessage])
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    const abortMsg: Message = {
                        role: 'assistant',
                        content: 'Request stopped by user.',
                    }
                    setMessages([...newMessages, abortMsg])
                } else {
                    const errorMessage =
                        err?.data?.message ||
                        (err instanceof Error ? err.message : 'Unknown error')
                    setError(errorMessage)

                    const errorMsg: Message = {
                        role: 'assistant',
                        content: `Error: ${errorMessage}\n\nPlease check the console for details.`,
                    }
                    setMessages([...newMessages, errorMsg])
                }
            } finally {
                setIsLoading(false)
                abortControllerRef.current = null
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
        if (!lastUserMessage) return

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

        // F11: pass the exact message base explicitly so the 50 ms gap cannot
        // observe a stale ref (previously a race window in effect timing).
        setTimeout(() => {
            sendMessage(lastUserMessage, messagesBeforeRerun)
        }, 50)
    }, [lastUserMessage, sendMessage])

    const clearMessages = useCallback(() => {
        setMessages([
            {
                role: 'system',
                content: SYSTEM_PROMPT,
            },
        ])
        setError(null)
        setLastUserMessage('')
    }, [])

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
