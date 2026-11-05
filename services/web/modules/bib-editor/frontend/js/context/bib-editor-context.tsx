import { createContext, FC, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { BibFieldWriteTarget } from '../utils/bib-write'
import type { BibAuthorDraft } from '../utils/bib-author-draft'
import type { PositionedBibtexEntry } from '../utils/bib-types'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import {
  BIB_DELETE_EVENT,
  BIB_IMPORT_EVENT,
  BIB_WRITE_EVENT,
  dispatchBibMutation,
} from '../utils/bib-editor-events'
import type {
  BibEntryIdRemap,
  BibHistoryUserEvent,
  BibWriteRequest,
  BibDeleteRequest,
  BibImportRequest,
} from '../utils/bib-editor-events'
export type {
  BibEntryIdRemap,
  BibHistoryUserEvent,
  BibWriteRequest,
  BibDeleteRequest,
  BibImportRequest,
} from '../utils/bib-editor-events'

export type { BibFieldWriteTarget } from '../utils/bib-write'

const EMPTY_ENTRY_ID_REMAPS: BibEntryIdRemap[] = []
const EMPTY_REMOVED_ENTRY_IDS: string[] = []

export type BibSelection = null | {
  entryId: string
  from: number
  // Stable while the same preview is open, even if the citation key changes.
  previewId: number
}

/** Shared contract for visual form edits across the details and Abstract controls. */
export type BibFormChangeHandler = (
  entry: BibtexEntry,
  historyUserEvent?: BibHistoryUserEvent,
  fieldIsValid?: boolean,
  fieldTarget?: BibFieldWriteTarget,
  draftIsValid?: boolean,
  nameDraft?: BibAuthorDraft
) => void

type BibEditorActions = {
  setEditorState: (
    entries: PositionedBibtexEntry[],
    revision: number,
    entryIdRemaps?: BibEntryIdRemap[],
    removedEntryIds?: string[],
    documentId?: string | null
  ) => void
  selectEntry: (entry: PositionedBibtexEntry) => void
  bindEditorView: (view: EditorView | null, canWrite?: () => boolean) => void
  setRestoredSessionKey: (key: string | null) => void
  deselect: () => void
  writeEntry: (request: BibWriteRequest) => boolean
  importMany: (request: BibImportRequest) => boolean
  deleteEntry: (request: BibDeleteRequest) => void
  setWriteFailure: (reason: string | null) => void
  clearWriteFailure: () => void
  setHistoryState: (canUndo: boolean, canRedo: boolean) => void
  isCurrentEditorView: (view: EditorView | undefined) => boolean
}

export type BibEditorState = {
  entries: PositionedBibtexEntry[]
  entriesDocumentId: string | null
  restoredSessionKey: string | null
  revision: number
  entryIdRemaps: BibEntryIdRemap[]
  removedEntryIds: string[]
  selection: BibSelection
  writeFailure: string | null
  canUndo: boolean
  canRedo: boolean
}

type BibEditorContextValue = BibEditorState & BibEditorActions

const BibEditorContext = createContext<BibEditorContextValue | undefined>(
  undefined
)

export const BibEditorProvider: FC<React.PropsWithChildren> = ({ children }) => {
  const [entries, setEntries] = useState<PositionedBibtexEntry[]>([])
  const [entriesDocumentId, setEntriesDocumentId] = useState<string | null>(null)
  // View and eligibility have one lifetime. Departure commits remain separate.
  const editorBindingRef = useRef<{ view: EditorView; canWrite: () => boolean } | null>(null)
  const [revision, setRevision] = useState(0)
  const [entryIdRemaps, setEntryIdRemaps] = useState(EMPTY_ENTRY_ID_REMAPS)
  const [removedEntryIds, setRemovedEntryIds] = useState(EMPTY_REMOVED_ENTRY_IDS)
  const [selection, setSelection] = useState<BibSelection>(null)
  // Session initialization survives Visual-panel unmounts, just like selection.
  const [restoredSessionKey, setRestoredSessionKey] = useState<string | null>(null)
  const projectedEntriesRef = useRef<PositionedBibtexEntry[]>([])
  const projectionDocumentIdRef = useRef<string | null>(null)
  const nextPreviewId = useRef(0)
  const [writeFailure, setWriteFailureState] = useState<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Entry ids are derived from citation key plus document-order occurrence index.
  // The extension reports both ID remaps and removed source occurrences.
  const setEditorState = useCallback(
    (
      newEntries: PositionedBibtexEntry[],
      newRevision: number,
      nextEntryIdRemaps?: BibEntryIdRemap[],
      nextRemovedEntryIds?: string[],
      documentId?: string | null
    ) => {
      const nextDocumentId = documentId ?? null
      if (projectionDocumentIdRef.current !== nextDocumentId) {
        projectionDocumentIdRef.current = nextDocumentId
        setRestoredSessionKey(null)
        setSelection(null)
      }
      setEntriesDocumentId(nextDocumentId)
      setRevision(newRevision)
      setEntryIdRemaps(
        nextEntryIdRemaps?.length ? nextEntryIdRemaps : EMPTY_ENTRY_ID_REMAPS
      )
      setRemovedEntryIds(
        nextRemovedEntryIds?.length
          ? nextRemovedEntryIds
          : EMPTY_REMOVED_ENTRY_IDS
      )
      const previousEntries = projectedEntriesRef.current
      projectedEntriesRef.current = newEntries
      setEntries(newEntries)
      setWriteFailureState(null)

      setSelection(prev => {
        if (!prev) return prev

        const remap = nextEntryIdRemaps?.find(
          item => item.previousEntryId === prev.entryId
        )
        const identityWasUpdated =
          nextEntryIdRemaps !== undefined || nextRemovedEntryIds !== undefined
        // Code-mode cut/paste can temporarily remove the current entry, and
        // whole-range swaps can report positional renames. Follow a unique key.
        const key = prev.entryId.slice(0, prev.entryId.lastIndexOf('#'))
        const followKey = !editorBindingRef.current && key &&
          previousEntries.filter(item => item.entry.key === key).length <= 1 &&
          newEntries.filter(item => item.entry.key === key).length <= 1
        const movedEntry = followKey
          ? newEntries.find(item => item.entry.id === prev.entryId)
          : undefined
        const selectedEntry = movedEntry ?? (remap
          ? newEntries.find(entry => entry.from === remap.from)
          : identityWasUpdated && nextRemovedEntryIds?.includes(prev.entryId)
            ? undefined
            : newEntries.find(entry => entry.entry.id === prev.entryId))

        if (!selectedEntry) return followKey ? prev : null
        if (
          selectedEntry.entry.id === prev.entryId &&
          selectedEntry.from === prev.from
        ) {
          return prev
        }
        return {
          ...prev,
          entryId: selectedEntry.entry.id,
          from: selectedEntry.from,
        }
      })
    },
    []
  )

  const bindEditorView = useCallback((view: EditorView | null, canWrite?: () => boolean) => {
    editorBindingRef.current = view && canWrite ? { view, canWrite } : null
  }, [])

  const isCurrentEditorView = useCallback((view: EditorView | undefined) => {
    return !!view && editorBindingRef.current?.view === view
  }, [])

  const setWriteFailure = useCallback((reason: string | null) => {
    setWriteFailureState(reason)
  }, [])

  const clearWriteFailure = useCallback(() => {
    setWriteFailureState(null)
  }, [])

  const setHistoryState = useCallback((nextUndo: boolean, nextRedo: boolean) => {
    setCanUndo(prev => (prev === nextUndo ? prev : nextUndo))
    setCanRedo(prev => (prev === nextRedo ? prev : nextRedo))
  }, [])

  const selectEntry = useCallback((entry: PositionedBibtexEntry) => {
    setSelection({
      entryId: entry.entry.id,
      from: entry.from,
      previewId: ++nextPreviewId.current,
    })
  }, [])

  const deselect = useCallback(() => {
    setSelection(null)
  }, [])

  // The extension owns CodeMirror writes. React requires its explicit
  // acknowledgement: a DOM event without a listener is not a successful write.
  const writeEntry = useCallback((request: BibWriteRequest) => {
    const binding = editorBindingRef.current
    if (!binding?.canWrite()) return false
    const { view } = binding
    return dispatchBibMutation(BIB_WRITE_EVENT, request, view)
  }, [])

  const importMany = useCallback((request: BibImportRequest) => {
    const binding = editorBindingRef.current
    if (!binding?.canWrite()) return false
    const { view } = binding
    return dispatchBibMutation(BIB_IMPORT_EVENT, request, view)
  }, [])

  const deleteEntry = useCallback((request: BibDeleteRequest) => {
    const binding = editorBindingRef.current
    if (!binding?.canWrite()) return
    const { view } = binding
    document.dispatchEvent(
      new CustomEvent(BIB_DELETE_EVENT, { detail: { ...request, view } })
    )
  }, [])

  const value = useMemo<BibEditorContextValue>(
    () => ({
      entries,
      entriesDocumentId,
      restoredSessionKey,
      setRestoredSessionKey,
      revision,
      entryIdRemaps,
      removedEntryIds,
      selection,
      writeFailure,
      canUndo,
      canRedo,
      setEditorState,
      selectEntry,
      bindEditorView,
      deselect,
      writeEntry,
      importMany,
      deleteEntry,
      setWriteFailure,
      clearWriteFailure,
      setHistoryState,
      isCurrentEditorView,
    }),
    [
      entries,
      entriesDocumentId,
      restoredSessionKey,
      setRestoredSessionKey,
      revision,
      entryIdRemaps,
      removedEntryIds,
      selection,
      writeFailure,
      canUndo,
      canRedo,
      setEditorState,
      selectEntry,
      bindEditorView,
      deselect,
      writeEntry,
      importMany,
      deleteEntry,
      setWriteFailure,
      clearWriteFailure,
      setHistoryState,
      isCurrentEditorView,
    ]
  )

  return (
    <BibEditorContext.Provider value={value}>
      {children}
    </BibEditorContext.Provider>
  )
}

export function useBibEditorContext() {
  const context = useContext(BibEditorContext)
  if (!context) {
    throw new Error(
      'useBibEditorContext is only available inside BibEditorProvider'
    )
  }
  return context
}
