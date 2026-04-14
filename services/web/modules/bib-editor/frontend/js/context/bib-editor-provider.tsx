/**
 * Bridge between the CodeMirror extension (which communicates via DOM events)
 * and the BibEditor React context.
 *
 * This provider wraps the BibEditorProvider and listens for events from the
 * CodeMirror extension to keep the context state in sync.
 */
import React, { useEffect, useCallback } from 'react'
import { BibEditorProvider, useBibEditorContext } from '../context/bib-editor-context'
import {
  BIB_ENTRIES_EVENT,
  BIB_DISPATCH_EVENT,
  BIB_DOC_CHANGE_EVENT,
} from '../extensions/bib-editor-extension'
import type { ParsedBibEntry } from '../utils/bib-parser'

/**
 * Inner component that subscribes to events and updates the context.
 */
function BibEditorBridge({ children }: { children: React.ReactNode }) {
  const { setEditorState, registerDispatch } = useBibEditorContext()

  // Register the dispatch function that sends changes to CodeMirror
  useEffect(() => {
    const dispatch = (changes: { from: number; to: number; insert: string }) => {
      document.dispatchEvent(
        new CustomEvent(BIB_DISPATCH_EVENT, { detail: changes })
      )
    }
    registerDispatch(dispatch)
  }, [registerDispatch])

  // Listen for entry updates from CodeMirror
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (!detail) return
      const { entries, source, isBibFile } = detail as {
        entries: ParsedBibEntry[]
        source: string
        isBibFile: boolean
      }
      setEditorState(isBibFile, entries, source)
    }

    document.addEventListener(BIB_ENTRIES_EVENT, handler)
    return () => document.removeEventListener(BIB_ENTRIES_EVENT, handler)
  }, [setEditorState])

  // Listen for doc-changed events (file type changes)
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (!detail) return
      const { isBibFile, source } = detail as {
        isBibFile: boolean
        source: string
      }
      if (!isBibFile) {
        // Clear entries when switching away from a .bib file
        setEditorState(false, [], source)
      }
    }

    document.addEventListener(BIB_DOC_CHANGE_EVENT, handler)
    return () => document.removeEventListener(BIB_DOC_CHANGE_EVENT, handler)
  }, [setEditorState])

  return <>{children}</>
}

/**
 * Composite provider: wraps BibEditorProvider + BibEditorBridge.
 * Use this as the root context provider for the module.
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
