// overleaf-lab: shared LLM model selection (owner request): ONE model choice,
// made via File → "Select LLM Model" (the menu's only selection entry point),
// is used by ALL AI surfaces — Chat AI Assistant, Review, AI Generate
// (Title/Abstract/Keywords) and the ask-AI selection context menu.
//
// overleaf-lab (owner request 2026-08-26): the selection is USER-SCOPED, not
// project-scoped: it is stored on the user profile (server-side,
// GET/POST /user/llm/selected-model) and applies across every project and
// browser. localStorage is kept only as the same-tab instant bridge between
// the surfaces (chat hook, toolbar) that live in separate React trees.
import { useCallback, useEffect, useState } from 'react'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { readSelectedModel, writeSelectedModel } from '../utils/llm-selected-model'

export const LLM_MODEL_CHANGED_EVENT = 'overleaf-llm-model-changed'

export interface LLMModelOption {
    value: string // model id / `u:<rowId>:<model>` (no '' pseudo-option anymore)
    label: string
    rowName?: string
}

async function fetchServerSelection(): Promise<string> {
    try {
        const data: any = await getJSON('/user/llm/selected-model')
        const value = typeof data?.selected === 'string' ? data.selected : ''
        return value
    }
    catch {
        return ''
    }
}

export function useLLMModelSelection() {
    const projectId = (getMeta('ol-project_id') as string | undefined) || undefined
    const [options, setOptions] = useState<LLMModelOption[]>([])
    const [loaded, setLoaded] = useState(false)
    const [selected, setSelected] = useState<string>(() => readSelectedModel(projectId))

    useEffect(() => {
        if (!projectId) {
            setLoaded(true)
            return
        }
        let cancelled = false
        async function load() {
            try {
                // Shared with the chat hook's model list: site models first,
                // then BYO rows namespaced u:<rowId>:<model>.
                const data: any = await getJSON<{
                    models?: Array<{ id: string; name?: string; isDefault?: boolean }>
                    userRows?: Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }>
                }>(`/project/${projectId}/llm/models`)
                if (cancelled) return
                const opts: LLMModelOption[] = []
                for (const m of data.models || []) {
                    opts.push({ value: m.id, label: m.name || m.id })
                }
                for (const row of data.userRows || []) {
                    for (const m of row.models || []) {
                        // overleaf-lab: the backend already returns fully
                        // namespaced ids (u:<rowId>:<model>) — use as-is.
                        opts.push({
                            value: m.id,
                            label: m.name || m.id,
                            rowName: row.name,
                        })
                    }
                }
                setOptions(opts)

                // overleaf-lab (owner request): user-scoped selection — the
                // profile value is authoritative. A stored value that no
                // longer exists (row deleted, model renamed) is dropped.
                const serverValue = await fetchServerSelection()
                if (cancelled) return
                const storedValue = readSelectedModel(projectId)
                const next =
                    (serverValue && opts.some(o => o.value === serverValue) && serverValue) ||
                    (storedValue && opts.some(o => o.value === storedValue) && storedValue) ||
                    ''
                if (next !== storedValue) {
                    writeSelectedModel(next, projectId)
                    setSelected(next)
                    if (next) {
                        // Tell the other surfaces (chat hook) about the
                        // restored user selection.
                        window.dispatchEvent(
                            new CustomEvent(LLM_MODEL_CHANGED_EVENT, { detail: { value: next } }),
                        )
                    }
                }
                setLoaded(true)
            }
            catch {
                if (!cancelled) {
                    // Model list unavailable (LLM disabled for this project?):
                    // no options; requests fall back to the deployment default.
                    setLoaded(true)
                }
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [projectId])

    // Keep the selection in sync across surface instances.
    useEffect(() => {
        const handler = (e: Event) => {
            const value = (e as CustomEvent).detail?.value
            if (typeof value === 'string') setSelected(value)
        }
        window.addEventListener(LLM_MODEL_CHANGED_EVENT, handler)
        return () => window.removeEventListener(LLM_MODEL_CHANGED_EVENT, handler)
    }, [])

    const apply = useCallback(
        (value: string) => {
            writeSelectedModel(value, projectId)
            setSelected(value)
            window.dispatchEvent(
                new CustomEvent(LLM_MODEL_CHANGED_EVENT, { detail: { value } }),
            )
            // Persist to the user profile (best-effort; the local bridge
            // already made the choice live everywhere in this tab).
            void postJSON('/user/llm/selected-model', { body: { selected: value } })
                .catch(() => {
                    /* profile write failed — local selection still works */
                })
        },
        [projectId],
    )

    const selectedOption = options.find(o => o.value === selected)
    const selectedLabel = selectedOption
        ? selectedOption.rowName
            ? `${selectedOption.rowName} · ${selectedOption.label}`
            : selectedOption.label
        : options.length
            ? 'Default'
            : ''

    return {
        projectId,
        options,
        loaded,
        selected,
        selectedLabel,
        apply,
    }
}
