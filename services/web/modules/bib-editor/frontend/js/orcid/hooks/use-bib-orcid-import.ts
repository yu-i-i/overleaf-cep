/** Bind generic ORCID results to the guarded atomic BibTeX editor import. */
import { useCallback, useEffect, useRef } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useBibEditorContext } from '../../context/bib-editor-context'
import type { OrcidImportItem, ImportResult } from '../orcid-api'
import { inspectOrcidImport, prepareOrcidImport } from '../../utils/bib-orcid-import'

type ImportGuard = {
  documentId: string
  revision: number
  doc: unknown
  keys: string[]
}

export function useBibOrcidImport(show: boolean) {
  const { entries, revision, importMany } = useBibEditorContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const view = useCodeMirrorViewContext()
  const guardRef = useRef<ImportGuard | null>(null)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // Capture the document at opening, not at import time. An unrelated edit or
  // document switch must not redirect an in-flight ORCID import to another file.
  useEffect(() => {
    if (!show) {
      guardRef.current = null
    } else if (!guardRef.current && currentDocumentId) {
      guardRef.current = {
        documentId: currentDocumentId,
        revision,
        doc: view.state.doc,
        keys: entriesRef.current.map(item => item.entry.key),
      }
    }
  }, [show, currentDocumentId, revision, view])

  const handleInspect = useCallback((item: OrcidImportItem) => inspectOrcidImport(item), [])

  const handleInsert = useCallback(
    (items: OrcidImportItem[]): ImportResult | false => {
      const guard = guardRef.current
      if (!guard || guard.documentId !== currentDocumentId ||
          guard.doc !== view.state.doc) return false
      const prepared = prepareOrcidImport(items, guard.keys)
      if (!prepared) return false
      const committed = importMany({
        entries: prepared.entries,
        expectedRevision: guard.revision,
        expectedDocument: guard.doc,
      })
      return committed ? {
        imported: prepared.entries.length,
        enriched: prepared.enriched,
        unusableIndices: prepared.unusableIndices,
        skippedIndices: prepared.skippedIndices,
      } : false
    },
    [importMany, currentDocumentId, view]
  )

  return { onInspect: handleInspect, onInsert: handleInsert }
}
