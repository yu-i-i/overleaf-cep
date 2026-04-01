import React, { FC, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { EquationEditorModal } from './equation-editor-modal'

/**
 * Toolbar button that opens the Equation Editor modal.
 * Registered via Overleaf's `sourceEditorToolbarComponents` module slot
 * so it renders below the main toolbar (as a panel).
 *
 * Also listens for 'latex-editor:open' custom events to support
 * opening from the context menu with pre-loaded LaTeX.
 */
const LatexEditorToolbarButton: FC = () => {
    const [isOpen, setIsOpen] = useState(false)
    const [initialLatex, setInitialLatex] = useState<string | undefined>(undefined)

    const handleInsert = useCallback((latex: string) => {
        // Try CodeMirror 6 first
        const cmContent = document.querySelector('.cm-content') as any
        const cmView =
            cmContent?.cmView?.view ??
            (window as any).cmView?.view ??
            (window as any).editorView

        if (cmView?.state) {
            const { from, to } = cmView.state.selection.main
            cmView.dispatch({
                changes: { from, to, insert: latex },
                selection: { anchor: from + latex.length },
            })
            cmView.focus()
            return
        }

        // Fallback: dispatch custom event for other integration handlers
        document.dispatchEvent(
            new CustomEvent('editor:insert-equation', { detail: { latex } })
        )
    }, [])

    const handleImport = useCallback((): string => {
        const cmContent = document.querySelector('.cm-content') as any
        const cmView =
            cmContent?.cmView?.view ??
            (window as any).cmView?.view ??
            (window as any).editorView

        if (cmView?.state) {
            const { from, to } = cmView.state.selection.main
            return cmView.state.doc.sliceString(from, to)
        }
        return ''
    }, [])

    const handleOpen = useCallback(() => {
        setInitialLatex(undefined)
        setIsOpen(true)
    }, [])

    const handleClose = useCallback(() => {
        setIsOpen(false)
        setInitialLatex(undefined)
    }, [])

    // Listen for context menu "Open in Equation Editor" event
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail
            setInitialLatex(detail?.latex || undefined)
            setIsOpen(true)
        }
        document.addEventListener('latex-editor:open', handler)
        return () => document.removeEventListener('latex-editor:open', handler)
    }, [])

    return (
        <>
            <button
                className="ol-cm-toolbar-button latex-editor-toolbar-button"
                onClick={handleOpen}
                title="Equation Editor"
                type="button"
                aria-label="Equation Editor"
            >
                Σ
            </button>
            {isOpen && (
                <EquationEditorPortal
                    onInsert={handleInsert}
                    onImport={handleImport}
                    onClose={handleClose}
                    initialLatex={initialLatex}
                />
            )}
        </>
    )
}

/**
 * Portal wrapper that renders the modal into document.body
 * to avoid z-index / overflow issues with the toolbar container.
 */
const EquationEditorPortal: FC<{
    onInsert: (latex: string) => void
    onImport: () => string
    onClose: () => void
    initialLatex?: string
}> = ({ onInsert, onImport, onClose, initialLatex }) => {
    const [container] = useState(() => {
        const el = document.createElement('div')
        el.id = 'latex-editor-modal-root'
        document.body.appendChild(el)
        return el
    })

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (container.parentNode) {
                container.parentNode.removeChild(container)
            }
        }
    }, [container])

    return createPortal(
        <EquationEditorModal
            onInsert={onInsert}
            onImport={onImport}
            onClose={onClose}
            initialLatex={initialLatex}
        />,
        container
    )
}

export default LatexEditorToolbarButton
