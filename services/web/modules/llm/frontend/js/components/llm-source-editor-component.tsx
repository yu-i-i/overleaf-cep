// Extension point wrapper for sourceEditorComponents
// Provides root-level LLM editor features (inline completion, floating toolbar)
import React, { useEffect, useRef, useState } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { inlineCompletionExtension } from './llm-completion'
import LLMToolbar, { LLMToolbarHandle } from './llm-toolbar'
import { useLLMFeatures } from '../hooks/use-llm-features'

function LLMSourceEditorComponent() {
    const view = useCodeMirrorViewContext()
    const toolbarRef = useRef<LLMToolbarHandle>(null)
    const [extensionInstalled, setExtensionInstalled] = useState(false)

    // overleaf-lab: publish the chat feature flag on window so the review-tooltip
    // core patch can hide its "Ask AI" entry when chat is disabled. That entry lives
    // in a core component that only knows the module flag (llmEnabled), not the
    // runtime chat toggle; this bridges the runtime flag to it. Defaults to enabled
    // until the flags load, matching the pre-flag behavior.
    const features = useLLMFeatures()
    useEffect(() => {
        ;(window as any).__llmChatEnabled = features.chatEnabled
    }, [features.chatEnabled])

    // Install inline completion extension
    useEffect(() => {
        if (!view || extensionInstalled) return
        try {
            const ext = inlineCompletionExtension()
            view.dispatch({
                effects: (window as any).__cm_llm_reconfigure
                    ? []
                    : // @ts-ignore
                    [],
            })
            setExtensionInstalled(true)
        } catch {
            // Extension may already be active or view not ready
        }
    }, [view, extensionInstalled])

    // Listen for "Ask AI" from the review tooltip menu
    useEffect(() => {
        const handleAskAI = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (!detail?.text || !view || !toolbarRef.current) return
            // overleaf-lab: chat disabled by admin -> do not open the toolbar.
            if (features.chatEnabled === false) return
            toolbarRef.current.show(view)
            // Immediately open the menu panel
            toolbarRef.current.openMenu?.()
        }
        document.addEventListener('llm-ask-ai-selection', handleAskAI)
        return () => document.removeEventListener('llm-ask-ai-selection', handleAskAI)
    }, [view, features.chatEnabled])

    return <LLMToolbar ref={toolbarRef} />
}

export default LLMSourceEditorComponent
