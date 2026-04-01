import React, {
    FC,
    useState,
    useCallback,
    useRef,
    useEffect,
    useMemo,
} from 'react'
import { MathLiveInput } from './mathlive-input'
import { latexCommands } from '../data/latex-commands.mjs'

type CommandResult = {
    cmd: string
    desc: string
    insert?: string
}

type Props = {
    onInsert: (latex: string) => void
    onImport: () => string
    onClose: () => void
    initialLatex?: string
}

type ExportWrapper = 'plain' | 'equation' | 'eqnarray' | 'inline' | 'display'

const WRAPPER_LABELS: Record<ExportWrapper, string> = {
    plain: 'Plain',
    equation: '\\begin{equation}',
    eqnarray: '\\begin{eqnarray}',
    inline: '$ … $',
    display: '\\[ … \\]',
}

function wrapLatex(latex: string, wrapper: ExportWrapper): string {
    switch (wrapper) {
        case 'equation':
            return `\\begin{equation}\n${latex}\n\\end{equation}`
        case 'eqnarray':
            return `\\begin{eqnarray}\n${latex}\n\\end{eqnarray}`
        case 'inline':
            return `$${latex}$`
        case 'display':
            return `\\[${latex}\\]`
        default:
            return latex
    }
}

export const EquationEditorModal: FC<Props> = ({
    onInsert,
    onImport,
    onClose,
    initialLatex,
}) => {
    const [latex, setLatex] = useState(initialLatex ?? '')
    const [minimized, setMinimized] = useState(false)
    const [showRawLatex, setShowRawLatex] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchOpen, setSearchOpen] = useState(false)
    const [exportWrapper, setExportWrapper] = useState<ExportWrapper>('plain')
    const [keyboardVisible, setKeyboardVisible] = useState(false)
    const mathfieldRef = useRef<any>(null)
    const modalRef = useRef<HTMLDivElement>(null)
    const searchWrapperRef = useRef<HTMLDivElement>(null)

    // Drag state
    const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
    const dragging = useRef(false)

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, input, label')) return
        e.preventDefault()
        const modal = modalRef.current
        if (!modal) return
        const rect = modal.getBoundingClientRect()
        dragging.current = true
        setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        if (!position) {
            setPosition({ x: rect.left, y: rect.top })
        }
    }, [position])

    useEffect(() => {
        if (!dragOffset) return
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragging.current) return
            const modal = modalRef.current
            const mw = modal?.offsetWidth ?? 840
            const mh = modal?.offsetHeight ?? 400
            const maxX = window.innerWidth - mw
            const maxY = window.innerHeight - mh
            setPosition({
                x: Math.max(0, Math.min(e.clientX - dragOffset.x, maxX)),
                y: Math.max(0, Math.min(e.clientY - dragOffset.y, maxY)),
            })
        }
        const handleMouseUp = () => {
            dragging.current = false
            setDragOffset(null)
        }
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [dragOffset])

    const modalStyle: React.CSSProperties | undefined = position
        ? { left: position.x, top: position.y, transform: 'none' }
        : undefined

    // Search across all 800+ commands
    const searchResults = useMemo<CommandResult[]>(() => {
        const q = searchQuery.trim().toLowerCase()
        if (!q) return []
        const results: CommandResult[] = []
        for (const entry of latexCommands) {
            if (
                entry.cmd.toLowerCase().includes(q) ||
                entry.desc.toLowerCase().includes(q)
            ) {
                results.push(entry)
            }
            if (results.length >= 30) break
        }
        return results
    }, [searchQuery])

    const insertIntoMathfield = useCallback((text: string) => {
        if (mathfieldRef.current) {
            mathfieldRef.current.executeCommand(['insert', text])
            mathfieldRef.current.focus()
        } else {
            setLatex(prev => prev + text)
        }
    }, [])

    const handleInsertCommand = useCallback((cmdLatex: string) => {
        insertIntoMathfield(cmdLatex)
        setSearchQuery('')
        setSearchOpen(false)
    }, [insertIntoMathfield])

    const handleExport = useCallback(() => {
        onInsert(wrapLatex(latex, exportWrapper))
    }, [latex, onInsert, exportWrapper])

    const handleImport = useCallback(() => {
        const selected = onImport()
        if (selected) {
            setLatex(selected)
            if (mathfieldRef.current) {
                mathfieldRef.current.setValue(selected)
            }
        }
    }, [onImport])

    const handleClear = useCallback(() => {
        setLatex('')
        if (mathfieldRef.current) {
            mathfieldRef.current.setValue('')
            mathfieldRef.current.focus()
        }
    }, [])

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (searchOpen) {
                    setSearchOpen(false)
                    setSearchQuery('')
                } else {
                    onClose()
                }
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [onClose, searchOpen])

    // Close search dropdown when clicking outside
    useEffect(() => {
        if (!searchOpen) return
        const handleClick = (e: MouseEvent) => {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
                setSearchOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [searchOpen])

    // Set initial latex into mathfield once it's ready
    useEffect(() => {
        if (initialLatex && mathfieldRef.current) {
            mathfieldRef.current.setValue(initialLatex)
        }
    }, [initialLatex])

    if (minimized) {
        return (
            <div
                className="latex-editor-modal latex-editor--minimized"
                role="dialog"
                aria-modal="true"
                aria-label="Equation Editor"
                ref={modalRef}
                style={modalStyle}
            >
                <div className="latex-editor-header" onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}>
                    <div className="latex-editor-header-group">
                        <div className="latex-editor-title modal-title">
                            Equation Editor
                        </div>
                    </div>
                    <div className="latex-editor-header-group latex-editor-actions">
                        <button
                            type="button"
                            className="latex-editor-minimize"
                            onClick={() => setMinimized(false)}
                            title="Restore"
                            aria-label="Restore"
                        >
                            □
                        </button>
                        <button
                            type="button"
                            className="latex-editor-close-button"
                            onClick={onClose}
                            aria-label="Close dialog"
                        />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div
            className="latex-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Equation Editor"
            ref={modalRef}
            style={modalStyle}
        >
            <div className="latex-editor-header" onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}>
                <div className="latex-editor-header-group">
                    <div className="latex-editor-title modal-title">
                        Equation Editor
                    </div>
                </div>
                <div className="latex-editor-header-group latex-editor-actions">
                    <label className="latex-editor-raw-toggle">
                        <input
                            type="checkbox"
                            checked={showRawLatex}
                            onChange={e => setShowRawLatex(e.target.checked)}
                        />
                        Show raw LaTeX
                    </label>
                    <button
                        type="button"
                        className="latex-editor-minimize"
                        onClick={() => setMinimized(true)}
                        title="Minimize"
                        aria-label="Minimize"
                    >
                        −
                    </button>
                    <button
                        type="button"
                        className="latex-editor-close-button"
                        onClick={onClose}
                        aria-label="Close dialog"
                    />
                </div>
            </div>

            <div className="latex-editor-body">
                <div className="latex-editor-content">
                    {showRawLatex ? (
                        <textarea
                            className="latex-editor-raw-textarea"
                            value={latex}
                            onChange={e => {
                                setLatex(e.target.value)
                                if (mathfieldRef.current) {
                                    mathfieldRef.current.setValue(e.target.value)
                                }
                            }}
                            placeholder="Raw LaTeX…"
                            aria-label="Raw LaTeX input"
                        />
                    ) : (
                        <MathLiveInput
                            value={latex}
                            onChange={setLatex}
                            mathfieldRef={mathfieldRef}
                            keyboardVisible={keyboardVisible}
                        />
                    )}

                    <div className="latex-editor-action-bar">
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={handleImport}
                            title="Import selection from document into editor"
                        >
                            Import Selection
                        </button>

                        <div className="latex-editor-search-wrapper" ref={searchWrapperRef}>
                            <input
                                type="search"
                                className="latex-editor-search-input"
                                placeholder="Search commands…"
                                value={searchQuery}
                                onChange={e => {
                                    setSearchQuery(e.target.value)
                                    setSearchOpen(e.target.value.trim().length > 0)
                                }}
                                onFocus={() => {
                                    if (searchQuery.trim()) setSearchOpen(true)
                                }}
                                aria-label="Search LaTeX commands"
                            />
                            {searchOpen && searchResults.length > 0 && (
                                <div className="latex-editor-search-dropdown">
                                    {searchResults.map((r, i) => (
                                        <button
                                            key={`${r.cmd}-${i}`}
                                            type="button"
                                            className="latex-editor-search-result"
                                            onClick={() => handleInsertCommand(r.insert ?? r.cmd)}
                                        >
                                            <code className="latex-editor-cmd-code">{r.cmd}</code>
                                            <span className="latex-editor-cmd-desc">{r.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
                                <div className="latex-editor-search-dropdown">
                                    <div className="latex-editor-no-results">No commands found</div>
                                </div>
                            )}
                        </div>

                        <div className="latex-editor-action-spacer" />
                        <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={handleClear}
                            title="Clear editor"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className={`btn btn-sm latex-editor-keyboard-toggle ${keyboardVisible ? 'btn-secondary' : 'btn-outline-secondary'}`}
                            onClick={() => setKeyboardVisible(v => !v)}
                            title={keyboardVisible ? 'Hide virtual keyboard' : 'Show virtual keyboard'}
                            aria-label={keyboardVisible ? 'Hide virtual keyboard' : 'Show virtual keyboard'}
                            aria-pressed={keyboardVisible}
                        >
                            ⌨
                        </button>
                        <div className="latex-editor-export-group">
                            <select
                                className="latex-editor-export-select"
                                value={exportWrapper}
                                onChange={e => setExportWrapper(e.target.value as ExportWrapper)}
                                aria-label="Export wrapper"
                                title="Choose how to wrap the exported LaTeX"
                            >
                                {(Object.keys(WRAPPER_LABELS) as ExportWrapper[]).map(k => (
                                    <option key={k} value={k}>{WRAPPER_LABELS[k]}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={handleExport}
                                title="Export equation to cursor in document"
                            >
                                Export to Cursor
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default EquationEditorModal
