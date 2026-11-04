/**
 * Bridge between the CodeMirror extension (DOM events) and the BibEditor
 * React context.
 *
 * The extension emits parsed entries, undo/redo state and
 * guarded-write failures. Projections carry both the CodeMirror view and the
 * owning OT document ID, since the same view is reused across file switches.
 */
import React, { useLayoutEffect, useRef } from 'react'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import type { BibEntriesDetail, BibHistoryStateDetail, BibWriteFailureDetail } from '../utils/bib-editor-events'
import {
  BibEditorProvider,
  useBibEditorContext,
} from './bib-editor-context'
import {
  BIB_ENTRIES_EVENT,
  BIB_WRITE_FAILED_EVENT,
  BIB_HISTORY_STATE_EVENT,
} from '../utils/bib-editor-events'

function BibEditorBridge({ children }: { children: React.ReactNode }) {
  const {
    setEditorState,
    setWriteFailure,
    setHistoryState,
    isCurrentEditorView,
  } = useBibEditorContext()
  const { currentDocumentId, openDocName } = useEditorOpenDocContext()
  // A newly attached CodeMirror plugin may publish its initial projection
  // during the document-switch commit. Keep the listener installed while the
  // active document changes, and identify events by document ID, not by a
  // view that the Visual panel has not yet bound.
  const activeDocumentRef = useRef({ currentDocumentId, openDocName })
  activeDocumentRef.current = { currentDocumentId, openDocName }

  useLayoutEffect(() => {
    // The active document ID is authoritative even before the Visual panel binds a view.
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<BibEntriesDetail>).detail
      if (
        !detail ||
        detail.documentId !== activeDocumentRef.current.currentDocumentId ||
        !activeDocumentRef.current.openDocName?.toLowerCase().endsWith('.bib') ||
        !detail.entries ||
        typeof detail.revision !== 'number' ||
        detail.isBibFile !== true
      ) return

      setEditorState(
        detail.entries,
        detail.revision,
        detail.entryIdRemaps,
        detail.removedEntryIds,
        detail.documentId
      )
    }
    const historyHandler = (ev: Event) => {
      const detail = (ev as CustomEvent<BibHistoryStateDetail>).detail
      if (detail && isCurrentEditorView(detail.view) && (typeof detail.canUndo === 'boolean' || typeof detail.canRedo === 'boolean')) {
        setHistoryState(!!detail.canUndo, !!detail.canRedo)
      }
    }

    const failedHandler = (ev: Event) => {
      const detail = (ev as CustomEvent<BibWriteFailureDetail>).detail
      // A failed guard is not a local form-validation error: the source changed
      // underneath the request, so the UI keeps the warning until a fresh parse
      // arrives or the user dismisses it.
      if (!isCurrentEditorView(detail?.view)) return
      setWriteFailure(detail?.reason ?? 'unknown')
    }

    document.addEventListener(BIB_HISTORY_STATE_EVENT, historyHandler)
    document.addEventListener(BIB_ENTRIES_EVENT, handler)
    document.addEventListener(BIB_WRITE_FAILED_EVENT, failedHandler)
    return () => {
      document.removeEventListener(BIB_HISTORY_STATE_EVENT, historyHandler)
      document.removeEventListener(BIB_ENTRIES_EVENT, handler)
      document.removeEventListener(
        BIB_WRITE_FAILED_EVENT,
        failedHandler
      )
    }
  }, [setEditorState, setWriteFailure, setHistoryState, isCurrentEditorView])

  return <>{children}</>
}

/**
 * Composite provider: BibEditorProvider + BibEditorBridge.
 * Registered in rootContextProviders (settings).
 */
export default function BibEditorContextProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <BibEditorProvider>
      <BibEditorBridge>{children}</BibEditorBridge>
    </BibEditorProvider>
  )
}
