import { useState, useCallback, useEffect, useRef } from 'react'
import getMeta from '@/utils/meta'

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
}

interface LLMResponse {
    choices: Array<{
        message: {
            content: string
        }
    }>
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
                console.warn('[LLMChat] No project ID available, skipping model fetch')
                return
            }
            try {
                const response = await fetch(`/project/${projectId}/llm/models`)
                if (!response.ok) {
                    throw new Error(`[LLMChat] Models endpoint returned ${response.status}`)
                }
                const data = await response.json()

                const { llmAllowUserSettings } = getMeta('ol-ExposedSettings') || {}
                let modelsFromBackend: LLMModel[] = data.models || []
                if (!llmAllowUserSettings) {
                    modelsFromBackend = modelsFromBackend.filter(
                        (m: LLMModel) =>
                            !m.isPersonal && !(m.id && m.id.startsWith('personal-'))
                    )
                }

                setModels(modelsFromBackend)
                setModelsError(false)

                const defaultModel =
                    modelsFromBackend.find((m: LLMModel) => m.isDefault) ||
                    modelsFromBackend[0]
                setSelectedModel(defaultModel?.id || '')
                setModelsLoaded(true)
            } catch (err) {
                console.error('[LLMChat] Failed to fetch models:', err)
                setModels([])
                setSelectedModel('')
                setModelsError(true)
                // Don't set modelsLoaded=true on error so button remains visible
            }
        }

        fetchModels()
    }, [projectId])

    const sendMessage = useCallback(
        async (userMessage: string) => {
            const newMessages: Message[] = [
                ...messagesRef.current,
                { role: 'user', content: userMessage },
            ]

            setMessages(newMessages)
            setIsLoading(true)
            setError(null)
            setLastUserMessage(userMessage)

            abortControllerRef.current = new AbortController()

            try {
                const url = `/project/${projectId}/llm/chat`
                const csrfToken = getMeta('ol-csrfToken')

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken,
                    },
                    body: JSON.stringify({
                        messages: newMessages,
                        model: selectedModel,
                    }),
                    signal: abortControllerRef.current.signal,
                    credentials: 'same-origin',
                })

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`)
                }

                const data: LLMResponse = await response.json()

                if (!data.choices || !data.choices[0]) {
                    throw new Error('Invalid response format from LLM API')
                }

                const assistantMessage: Message = {
                    role: 'assistant',
                    content: data.choices[0].message.content,
                }

                setMessages([...newMessages, assistantMessage])
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    const abortMsg: Message = {
                        role: 'assistant',
                        content: '⚠️ Request stopped by user.',
                    }
                    setMessages([...newMessages, abortMsg])
                } else {
                    const errorMessage =
                        err instanceof Error ? err.message : 'Unknown error'
                    setError(errorMessage)

                    const errorMsg: Message = {
                        role: 'assistant',
                        content: `❌ Error: ${errorMessage}\n\nPlease check the console for details.`,
                    }
                    setMessages([...newMessages, errorMsg])
                }
            } finally {
                setIsLoading(false)
                abortControllerRef.current = null
            }
        },
        [projectId, selectedModel]
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

        setTimeout(() => {
            sendMessage(lastUserMessage)
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
