// LLM Floating Toolbar for CodeMirror Editor
// Adapted from lcpu-club/overleaf — provides selection-based AI actions
// (paraphrase, style change, summarize, explain, etc.)

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react'
import { EditorView } from '@codemirror/view'
import { marked } from 'marked'
import getMeta from '@/utils/meta'

export type LLMToolbarHandle = {
    show: (view: EditorView) => void
    hide: () => void
    openMenu: () => void
    getSelectedText: () => string
}

type ParaphraseKind =
    | 'paraphrase'
    | 'style'
    | 'splitjoin'
    | 'summarize'
    | 'explain'
    | 'title'
    | 'abstract'
    | 'chat'

const kindTitleMap: Record<ParaphraseKind, string> = {
    paraphrase: 'Paraphrase',
    style: 'Change Style',
    splitjoin: 'Split / Join',
    summarize: 'Summarize',
    explain: 'Explain',
    title: 'Title Generator',
    abstract: 'Abstract Generator',
    chat: 'AI Response',
}

function escapeHtml(s: string) {
    return s.replace(
        /[&<>"']/g,
        c =>
        ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[c] || c)
    )
}

function base64EncodeUnicode(str: string) {
    try {
        return btoa(unescape(encodeURIComponent(str)))
    } catch {
        return btoa(str)
    }
}

function base64DecodeUnicode(b64: string) {
    try {
        return decodeURIComponent(escape(atob(b64)))
    } catch {
        return atob(b64)
    }
}

const Spinner = () => (
    <div
        style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            border: '2px solid rgba(255,255,255,0.12)',
            borderTopColor: 'rgba(255,255,255,0.7)',
            animation: 'llm-spin 0.9s linear infinite',
        }}
    />
)

const LLMToolbar = forwardRef<LLMToolbarHandle, {}>((_, ref) => {
    const [anchorShown, setAnchorShown] = useState(false)
    const [panelRect, setPanelRect] = useState({ top: 0, left: 0, width: 520 })
    const [anchorPos, setAnchorPos] = useState({ top: 0, left: 0 })
    const [panelMode, setPanelMode] = useState<
        'hidden' | 'menu' | 'chat' | 'paraphrase'
    >('hidden')
    const [submenu, setSubmenu] = useState<null | 'style' | 'splitjoin'>(null)

    const [query, setQuery] = useState('')
    const [selectionText, setSelectionText] = useState('')
    const [selectionRange, setSelectionRange] = useState<{
        from: number
        to: number
    } | null>(null)
    const [result, setResult] = useState('')
    const [loading, setLoading] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [showDiff, setShowDiff] = useState(false)
    const [kind, setKind] = useState<ParaphraseKind>('paraphrase')

    const viewRef = useRef<EditorView | null>(null)
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const panelRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLTextAreaElement | null>(null)
    const editRef = useRef<HTMLTextAreaElement | null>(null)

    const postToAPI = async (mode: number, ask: string) => {
        const projectId = getMeta('ol-project_id')
        const csrfToken = getMeta('ol-csrfToken')

        // Build a prompt based on the mode
        const modePrompts: Record<number, string> = {
            0: ask, // free-form chat
            1: `Paraphrase the following LaTeX text, keeping all LaTeX commands intact:\n\n${selectionText}`,
            2: `Rewrite the following LaTeX text in a scientific academic style:\n\n${selectionText}`,
            3: `Rewrite the following LaTeX text more concisely:\n\n${selectionText}`,
            4: `Rewrite the following LaTeX text in a punchy style:\n\n${selectionText}`,
            5: `Split the following LaTeX paragraph into multiple shorter paragraphs:\n\n${selectionText}`,
            6: `Join the following LaTeX paragraphs into a single cohesive paragraph:\n\n${selectionText}`,
            7: `Summarize the following LaTeX text:\n\n${selectionText}`,
            8: `Explain the following LaTeX text:\n\n${selectionText}`,
            9: `Generate an academic title based on this LaTeX content:\n\n${selectionText}`,
            10: `Generate an academic abstract based on this LaTeX content:\n\n${selectionText}`,
        }

        const messages = [
            {
                role: 'system',
                content:
                    'You are a helpful LaTeX writing assistant. Respond with clean LaTeX code when appropriate.',
            },
            {
                role: 'user',
                content: modePrompts[mode] || ask,
            },
        ]

        try {
            const resp = await fetch(`/project/${projectId}/llm/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'same-origin',
                body: JSON.stringify({ messages }),
            })

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            const json = await resp.json()
            if (json?.choices?.[0]?.message?.content) {
                return json.choices[0].message.content
            }
            throw new Error('Unexpected response format')
        } catch (err: any) {
            console.error('[LLM Toolbar] API error', err)
            return `Error: ${err?.message || 'Request failed'}`
        }
    }

    const startFetch = async (
        mode: number,
        k: ParaphraseKind,
        ask?: string
    ) => {
        setKind(k)
        setPanelMode(k === 'chat' ? 'chat' : 'paraphrase')
        setLoading(true)
        setEditMode(false)
        setShowDiff(false)
        setResult('')

        const resp = await postToAPI(mode, (ask ?? query).trim())
        setResult(resp)
        setLoading(false)
    }

    const renderer = useMemo(() => {
        const r = new marked.Renderer()
        r.code = (
            code: string,
            infostring: string | undefined,
            _escaped: boolean
        ) => {
            const lang = (infostring || '').trim().toLowerCase()
            const isLatex =
                lang === 'latex' ||
                lang === 'tex' ||
                code.trim().startsWith('\\')
            const safeCodeHtml = escapeHtml(code)
            if (isLatex) {
                const b64 = base64EncodeUnicode(code)
                return `<div class="llm-latex-block" style="position:relative;"><button class="llm-copy-latex" data-code="${b64}" title="Copy LaTeX" style="position:absolute;right:8px;top:8px;border-radius:6px;padding:4px 6px;border:none;background:rgba(255,255,255,0.03);color:#e6eef8;cursor:pointer">📋</button><pre style="margin:0;"><code class="language-${escapeHtml(lang)}">${safeCodeHtml}</code></pre></div>`
            }
            return `<pre><code class="language-${escapeHtml(lang)}">${safeCodeHtml}</code></pre>`
        }
        return r
    }, [])

    const renderedHtml = useMemo(() => {
        try {
            return marked.parse(result || 'No result yet.', { renderer })
        } catch {
            return escapeHtml(result || 'No result yet.')
        }
    }, [result, renderer])

    // Copy button delegation
    useEffect(() => {
        const root = wrapRef.current
        if (!root) return
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            const btn = target.closest
                ? (target.closest('.llm-copy-latex') as HTMLElement | null)
                : null
            if (!btn) return
            const b64 = btn.getAttribute('data-code')
            if (!b64) return
            const code = base64DecodeUnicode(b64)
                ; (async () => {
                    try {
                        await navigator.clipboard.writeText(code)
                        const prev = btn.innerText
                        btn.innerText = '✓'
                        setTimeout(() => {
                            btn.innerText = prev
                        }, 900)
                    } catch {
                        btn.innerText = '✕'
                        setTimeout(() => {
                            btn.innerText = '📋'
                        }, 900)
                    }
                })()
        }
        root.addEventListener('click', handler)
        return () => root.removeEventListener('click', handler)
    }, [])

    useImperativeHandle(ref, () => ({
        show: (view: EditorView) => {
            viewRef.current = view
            const sel = view.state.selection.main
            if (sel.empty) return

            const wrapRect = wrapRef.current?.getBoundingClientRect()
            const editorRect = view.dom.getBoundingClientRect()
            const coordsFrom = view.coordsAtPos(sel.from)
            const coordsTo = view.coordsAtPos(sel.to)
            const toLocal = (c: { left: number; top: number }) => ({
                x: wrapRect ? c.left - wrapRect.left : c.left,
                y: wrapRect ? c.top - wrapRect.top : c.top,
            })

            let aTop = 0,
                aLeft = 0
            if (coordsFrom && coordsTo) {
                const top = Math.min(coordsFrom.top, coordsTo.top)
                const bottom = Math.max(coordsFrom.bottom, coordsTo.bottom)
                const right = Math.max(coordsFrom.right, coordsTo.right)
                const midY = top + (bottom - top) / 2
                aTop = toLocal({ left: 0, top: midY }).y - 14
                aLeft = toLocal({ left: right, top: 0 }).x - 14
            } else {
                aTop =
                    editorRect.top +
                    editorRect.height / 2 -
                    (wrapRect?.top ?? 0) -
                    14
                aLeft = editorRect.right - (wrapRect?.left ?? 0) - 44
            }

            const containerW = wrapRect?.width ?? window.innerWidth
            const containerH = wrapRect?.height ?? window.innerHeight
            const clampedTop = Math.round(
                Math.max(8, Math.min(containerH - 44, aTop))
            )
            const clampedLeft = Math.round(
                Math.max(8, Math.min(containerW - 44, aLeft))
            )

            const width = Math.max(320, Math.min(560, containerW - 24))
            const panelTop = Math.round(
                Math.max(
                    12,
                    Math.min(
                        (wrapRect ? editorRect.top - wrapRect.top : 0) + 52,
                        containerH - 260 - 12
                    )
                )
            )
            const panelLeft = Math.round(
                Math.max(
                    12,
                    Math.min(
                        containerW - width - 12,
                        (wrapRect ? editorRect.left - wrapRect.left : 0) +
                        editorRect.width / 2 -
                        width / 2
                    )
                )
            )

            setPanelRect({ top: panelTop, left: panelLeft, width })
            setAnchorPos({ top: clampedTop, left: clampedLeft })
            setSelectionText(view.state.sliceDoc(sel.from, sel.to))
            setSelectionRange({ from: sel.from, to: sel.to })
            setAnchorShown(true)
            setPanelMode('hidden')
            document.dispatchEvent(
                new CustomEvent('llm-toolbar-active', { detail: { active: true } })
            )
        },
        hide: () => {
            setAnchorShown(false)
            setPanelMode('hidden')
            setSubmenu(null)
            document.dispatchEvent(
                new CustomEvent('llm-toolbar-active', { detail: { active: false } })
            )
        },
        openMenu: () => {
            setAnchorShown(true)
            setPanelMode('menu')
        },
        getSelectedText: () => selectionText,
    }))

    useEffect(() => {
        if (panelMode !== 'hidden') {
            requestAnimationFrame(() =>
                inputRef.current?.focus({ preventScroll: true } as any)
            )
        }
    }, [panelMode])

    const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            startFetch(0, 'chat')
        } else if (e.key === 'Escape') {
            setPanelMode('hidden')
            setAnchorShown(false)
        }
    }

    const replaceSelectionWith = (text: string) => {
        const view = viewRef.current
        const r = selectionRange
        if (!view || !r) return
        view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
        setPanelMode('hidden')
        setAnchorShown(false)
        setResult('')
        setQuery('')
    }

    const insertCodeAfterSelection = (text: string) => {
        const view = viewRef.current
        const r = selectionRange
        if (!view || !r) return

        // Extract LaTeX from markdown
        const extractLatex = (md: string) => {
            if (!md) return ''
            let m: RegExpExecArray | null
            let collected = ''

            const fencedLangRegex = /```\s*(?:latex|tex)\n([\s\S]*?)```/gi
            while ((m = fencedLangRegex.exec(md)) !== null)
                collected += m[1].trim() + '\n'
            if (collected) return collected.trim()

            const fencedAny = /```(?:\w+)?\n([\s\S]*?)```/g
            while ((m = fencedAny.exec(md)) !== null) {
                const code = m[1]
                if (/\\begin\{|\\[a-zA-Z]+|\\frac\{|\\end\{/.test(code))
                    collected += code.trim() + '\n'
            }
            if (collected) return collected.trim()

            return md.trim()
        }

        const code = extractLatex(text)
        const toInsert = code ? '\n' + code + '\n' : '\n' + text + '\n'
        view.dispatch({ changes: { from: r.to, to: r.to, insert: toInsert } })
        setPanelMode('hidden')
        setAnchorShown(false)
        setQuery('')
    }

    const copyToClipboard = async (t: string) => {
        try {
            await navigator.clipboard.writeText(t)
        } catch {
            // ignore
        }
    }

    const kindToMode: Record<ParaphraseKind, number> = {
        paraphrase: 1,
        style: 2,
        splitjoin: 5,
        summarize: 7,
        explain: 8,
        title: 9,
        abstract: 10,
        chat: 0,
    }

    const contentMaxHeight = Math.max(
        140,
        Math.round(window.innerHeight * 0.5)
    )

    return (
        <div
            ref={wrapRef}
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 9999,
            }}
        >
            <style>{`@keyframes llm-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        .llm-anchor{position:absolute;width:28px;height:28px;border-radius:999px;background:linear-gradient(180deg,#0b1220,#0f172a);color:#eef2ff;border:1px solid rgba(255,255,255,0.08);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 6px 22px rgba(2,6,23,0.45);cursor:pointer;pointer-events:auto}
        .llm-panel{position:absolute;pointer-events:auto;user-select:none}
        .llm-input-card{width:100%;background:linear-gradient(180deg,#071021,#071827);border-radius:14px;padding:12px 12px 12px 56px;position:relative;box-shadow:0 14px 40px rgba(3,8,22,0.55);border:1px solid rgba(255,255,255,0.04)}
        .llm-badge{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;color:#e6eef8}
        .llm-input{width:100%;min-height:40px;max-height:160px;padding:8px 84px 8px 10px;border-radius:10px;background:transparent;color:#e6eef8;border:1px solid rgba(255,255,255,0.06);outline:none;resize:none;line-height:20px;font-size:14px;box-sizing:border-box}
        .llm-send{position:absolute;right:44px;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,0.02);display:flex;align-items:center;justify-content:center;cursor:pointer}
        .llm-close{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,0.02);display:flex;align-items:center;justify-content:center;cursor:pointer}
        .llm-menu{margin-top:0;background:linear-gradient(180deg,#071021,#071827);border-radius:12px;padding:10px 8px;color:#dfe7ee;border:1px solid rgba(255,255,255,0.04);box-shadow:0 14px 40px rgba(3,8,22,0.55)}
        .llm-item{height:40px;display:flex;align-items:center;gap:10px;padding:0 10px;border-radius:10px;cursor:pointer}
        .llm-item:hover{background:rgba(255,255,255,0.04)}
        .llm-paraphrase-card{pointer-events:auto;width:100%;background:#071223;border-radius:12px;padding:12px;box-shadow:0 14px 40px rgba(3,8,22,0.55);border:1px solid rgba(255,255,255,0.06);color:#e6eef8}
        .llm-paraphrase-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:10px}
        .llm-btn{padding:8px 12px;border-radius:10px;cursor:pointer;border:1px solid rgba(255,255,255,0.06);background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));color:#e6eef8}
        .llm-btn.llm-primary{background:linear-gradient(180deg, rgba(16,185,129,0.14), rgba(16,185,129,0.08));border:1px solid rgba(16,185,129,0.22)}
        .llm-result-html{overflow-x:hidden;word-wrap:break-word;word-break:break-word;overflow-wrap:anywhere}
        .llm-result-html h1,.llm-result-html h2,.llm-result-html h3{color:#e6eef8;margin:6px 0}
        .llm-result-html p,.llm-result-html li{color:#dfe7ee;margin:4px 0}
        .llm-result-html pre{background:rgba(0,0,0,0.45);padding:8px;border-radius:6px;overflow-x:auto;color:#e6eef8;white-space:pre-wrap;word-wrap:break-word;max-width:100%}
        .llm-result-html code{word-wrap:break-word;white-space:pre-wrap}
      `}</style>

            {/* Circular AI anchor button - visible after selection */}
            {anchorShown && panelMode === 'hidden' && !loading && (
                <button
                    className="llm-anchor"
                    style={{ top: anchorPos.top, left: anchorPos.left }}
                    onClick={() => setPanelMode('menu')}
                    title="AI"
                >
                    AI
                </button>
            )}

            {/* Menu panel */}
            {anchorShown && panelMode === 'menu' && (
                <div
                    ref={panelRef}
                    className="llm-panel"
                    style={{
                        top: panelRect.top,
                        left: panelRect.left,
                        width: panelRect.width,
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="llm-input-card">
                            <div className="llm-badge">AI</div>
                            <textarea
                                ref={inputRef}
                                className="llm-input"
                                placeholder="Ask AI for help"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={onInputKeyDown}
                                rows={1}
                            />
                            <button
                                className="llm-send"
                                onClick={() => startFetch(0, 'chat')}
                                title="Send"
                            >
                                ↑
                            </button>
                            <button
                                className="llm-close"
                                onClick={() => {
                                    setPanelMode('hidden')
                                    setAnchorShown(false)
                                }}
                                title="Close"
                            >
                                ×
                            </button>
                        </div>

                        <div
                            className="llm-menu"
                            style={{ width: Math.min(220, panelRect.width - 36) }}
                        >
                            <div
                                style={{ fontSize: 12, color: '#98a3af', padding: '6px 8px' }}
                            >
                                Context Options
                            </div>
                            <div
                                className="llm-item"
                                onClick={() => startFetch(1, 'paraphrase')}
                            >
                                ✏️ Paraphrase
                            </div>

                            <div
                                style={{ position: 'relative' }}
                                onMouseEnter={() => setSubmenu('style')}
                                onMouseLeave={() => setSubmenu(null)}
                            >
                                <div className="llm-item">🎨 Change style</div>
                                {submenu === 'style' && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            left: '104%',
                                            top: 0,
                                            minWidth: 120,
                                        }}
                                        className="llm-menu"
                                    >
                                        <div
                                            className="llm-item"
                                            onClick={() => startFetch(2, 'style')}
                                        >
                                            Scientific
                                        </div>
                                        <div
                                            className="llm-item"
                                            onClick={() => startFetch(3, 'style')}
                                        >
                                            Concise
                                        </div>
                                        <div
                                            className="llm-item"
                                            onClick={() => startFetch(4, 'style')}
                                        >
                                            Punchy
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div
                                style={{ position: 'relative' }}
                                onMouseEnter={() => setSubmenu('splitjoin')}
                                onMouseLeave={() => setSubmenu(null)}
                            >
                                <div className="llm-item">🔀 Split/Join</div>
                                {submenu === 'splitjoin' && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            left: '104%',
                                            top: 0,
                                            minWidth: 120,
                                        }}
                                        className="llm-menu"
                                    >
                                        <div
                                            className="llm-item"
                                            onClick={() => startFetch(5, 'splitjoin')}
                                        >
                                            Split
                                        </div>
                                        <div
                                            className="llm-item"
                                            onClick={() => startFetch(6, 'splitjoin')}
                                        >
                                            Join
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div
                                className="llm-item"
                                onClick={() => startFetch(7, 'summarize')}
                            >
                                📝 Summarize
                            </div>
                            <div
                                className="llm-item"
                                onClick={() => startFetch(8, 'explain')}
                            >
                                ℹ️ Explain
                            </div>

                            <div
                                style={{
                                    height: 1,
                                    background: 'rgba(255,255,255,0.03)',
                                    margin: '8px 0',
                                }}
                            />
                            <div
                                style={{ fontSize: 12, color: '#98a3af', padding: '6px 8px' }}
                            >
                                Generators
                            </div>
                            <div
                                className="llm-item"
                                onClick={() => startFetch(9, 'title')}
                            >
                                📄 Title Generator
                            </div>
                            <div
                                className="llm-item"
                                onClick={() => startFetch(10, 'abstract')}
                            >
                                📋 Abstract Generator
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Chat panel */}
            {anchorShown && panelMode === 'chat' && (
                <div
                    ref={panelRef}
                    className="llm-panel"
                    style={{
                        top: panelRect.top,
                        left: panelRect.left,
                        width: panelRect.width,
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="llm-input-card">
                            <div className="llm-badge">AI</div>
                            <textarea
                                ref={inputRef}
                                className="llm-input"
                                placeholder="Ask AI for help"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={onInputKeyDown}
                                rows={1}
                            />
                            <button
                                className="llm-send"
                                onClick={() => startFetch(0, 'chat')}
                                title="Send"
                            >
                                ↑
                            </button>
                            <button
                                className="llm-close"
                                onClick={() => {
                                    setPanelMode('hidden')
                                    setAnchorShown(false)
                                    setQuery('')
                                }}
                                title="Close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="llm-paraphrase-card">
                            <div style={{ fontSize: 13, color: '#9fb0c6' }}>
                                {kindTitleMap['chat']}
                            </div>

                            {loading ? (
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: 24,
                                    }}
                                >
                                    <Spinner />
                                    <div style={{ marginLeft: 10, color: '#9aa4b2' }}>
                                        Waiting for AI...
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div
                                        style={{
                                            minHeight: 88,
                                            maxHeight: contentMaxHeight,
                                            overflowY: 'auto',
                                            overflowX: 'hidden',
                                            paddingRight: 8,
                                        }}
                                    >
                                        <div
                                            className="llm-result-html"
                                            dangerouslySetInnerHTML={{ __html: renderedHtml }}
                                        />
                                    </div>

                                    <div className="llm-paraphrase-footer">
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => {
                                                setPanelMode('hidden')
                                                setQuery('')
                                                setResult('')
                                            }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => insertCodeAfterSelection(result)}
                                            disabled={!result}
                                        >
                                            Insert
                                        </button>
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => startFetch(0, 'chat')}
                                            disabled={loading || !query.trim()}
                                        >
                                            Regenerate
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Paraphrase panel */}
            {panelMode === 'paraphrase' && (
                <div
                    className="llm-panel"
                    style={{
                        top: panelRect.top,
                        left: panelRect.left,
                        width: panelRect.width,
                    }}
                >
                    <div className="llm-paraphrase-card">
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 8,
                            }}
                        >
                            <div style={{ fontSize: 13, color: '#9fb0c6' }}>
                                {kindTitleMap[kind]}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    className="llm-btn"
                                    onClick={() => copyToClipboard(result)}
                                >
                                    📋 Copy
                                </button>
                                <button
                                    className="llm-btn"
                                    onClick={() => setEditMode(s => !s)}
                                >
                                    ✏️ {editMode ? 'Done' : 'Edit'}
                                </button>
                                {kind !== 'title' && kind !== 'abstract' && (
                                    <button
                                        className="llm-btn"
                                        onClick={() => setShowDiff(s => !s)}
                                    >
                                        {showDiff ? 'Hide' : 'Track'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {loading ? (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: 24,
                                }}
                            >
                                <Spinner />
                                <div style={{ marginLeft: 10, color: '#9aa4b2' }}>
                                    Waiting for AI...
                                </div>
                            </div>
                        ) : (
                            <>
                                {editMode ? (
                                    <textarea
                                        ref={editRef}
                                        value={result}
                                        onChange={e => setResult(e.target.value)}
                                        style={{
                                            width: '100%',
                                            minHeight: 88,
                                            maxHeight: contentMaxHeight,
                                            overflowY: 'auto',
                                            overflowX: 'hidden',
                                            padding: 10,
                                            borderRadius: 8,
                                            background: 'rgba(255,255,255,0.02)',
                                            color: '#e6eef8',
                                            outline: 'none',
                                            resize: 'vertical',
                                            boxSizing: 'border-box',
                                            border: 'none',
                                        }}
                                    />
                                ) : (
                                    <div style={{ minHeight: 88 }}>
                                        <div
                                            style={{
                                                maxHeight: contentMaxHeight,
                                                overflowY: 'auto',
                                                overflowX: 'hidden',
                                                paddingRight: 8,
                                            }}
                                        >
                                            <div
                                                className="llm-result-html"
                                                style={{ color: '#e6eef8' }}
                                                dangerouslySetInnerHTML={{ __html: renderedHtml }}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="llm-paraphrase-footer">
                                    <button
                                        className="llm-btn llm-primary"
                                        onClick={() => {
                                            setPanelMode('hidden')
                                            setAnchorShown(false)
                                            setResult('')
                                            setQuery('')
                                        }}
                                    >
                                        Cancel
                                    </button>

                                    {kind === 'title' || kind === 'abstract' ? (
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => insertCodeAfterSelection(result)}
                                            disabled={loading || !result}
                                        >
                                            Insert
                                        </button>
                                    ) : kind === 'summarize' || kind === 'explain' ? null : (
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => replaceSelectionWith(result)}
                                            disabled={loading || !result}
                                        >
                                            Replace
                                        </button>
                                    )}

                                    <button
                                        className="llm-btn llm-primary"
                                        onClick={() => startFetch(kindToMode[kind], kind)}
                                        disabled={loading}
                                    >
                                        Regenerate
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
})

LLMToolbar.displayName = 'LLMToolbar'
export default LLMToolbar
