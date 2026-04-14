/**
 * BibEditor context - manages the state shared between the CodeMirror extension
 * and the React sidebar panel.
 *
 * Communication flow:
 * 1. CodeMirror extension detects .bib file and parses entries
 * 2. It posts entries + view reference to this context via events
 * 3. The sidebar panel reads from this context and dispatches edits back
 */
import {
  createContext,
  FC,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { BibEntry } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'
import {
  serializeBibEntry,
  replaceEntryInSource,
  removeEntryFromSource,
  generateCitationKey,
} from '../utils/bib-parser'

export type BibEditorMode = 'list' | 'edit' | 'add'

export type BibEditorState = {
  /** Whether the current document is a .bib file */
  isBibFile: boolean
  /** Parsed entries from the current document */
  entries: ParsedBibEntry[]
  /** Currently selected entry for editing */
  selectedEntry: ParsedBibEntry | null
  /** Current UI mode */
  mode: BibEditorMode
  /** The full source text of the .bib document */
  source: string
}

export type BibEditorActions = {
  /** Update the parsed state from the editor */
  setEditorState: (isBibFile: boolean, entries: ParsedBibEntry[], source: string) => void
  /** Select an entry for editing */
  selectEntry: (entry: ParsedBibEntry | null) => void
  /** Switch mode */
  setMode: (mode: BibEditorMode) => void
  /** Save an edited entry back to the document */
  saveEntry: (original: ParsedBibEntry, updated: BibEntry) => void
  /** Add a new entry to the document */
  addEntry: (entry: BibEntry) => void
  /** Delete an entry from the document */
  deleteEntry: (entry: ParsedBibEntry) => void
  /** Register a dispatch function to push changes to the editor */
  registerDispatch: (fn: DispatchFn) => void
}

type DispatchFn = (changes: { from: number; to: number; insert: string }) => void

const BibEditorContext = createContext<
  (BibEditorState & BibEditorActions) | undefined
>(undefined)

export const BibEditorProvider: FC<React.PropsWithChildren> = ({ children }) => {
  const [isBibFile, setIsBibFile] = useState(false)
  const [entries, setEntries] = useState<ParsedBibEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<ParsedBibEntry | null>(null)
  const [mode, setMode] = useState<BibEditorMode>('list')
  const [source, setSource] = useState('')
  const [dispatchFn, setDispatchFn] = useState<DispatchFn | null>(null)

  const registerDispatch = useCallback((fn: DispatchFn) => {
    setDispatchFn(() => fn)
  }, [])

  const setEditorState = useCallback(
    (newIsBibFile: boolean, newEntries: ParsedBibEntry[], newSource: string) => {
      setIsBibFile(newIsBibFile)
      setEntries(newEntries)
      setSource(newSource)
      // If editing an entry, update the selected entry reference if it still exists
      setSelectedEntry(prev => {
        if (!prev) return null
        const updated = newEntries.find(e => e.id === prev.id)
        return updated || null
      })
    },
    []
  )

  const selectEntry = useCallback(
    (entry: ParsedBibEntry | null) => {
      setSelectedEntry(entry)
      setMode(entry ? 'edit' : 'list')
    },
    []
  )

  const saveEntry = useCallback(
    (original: ParsedBibEntry, updated: BibEntry) => {
      if (!dispatchFn) return
      const newText = serializeBibEntry(updated)
      dispatchFn({
        from: original.sourceStart,
        to: original.sourceEnd,
        insert: newText,
      })
      setMode('list')
      setSelectedEntry(null)
    },
    [dispatchFn]
  )

  const addEntry = useCallback(
    (entry: BibEntry) => {
      if (!dispatchFn) return
      const newText = '\n' + serializeBibEntry(entry) + '\n'
      // Insert at the end of the document
      const insertPos = source.length
      dispatchFn({
        from: insertPos,
        to: insertPos,
        insert: newText,
      })
      setMode('list')
    },
    [dispatchFn, source]
  )

  const deleteEntry = useCallback(
    (entry: ParsedBibEntry) => {
      if (!dispatchFn) return
      let end = entry.sourceEnd
      // Consume trailing whitespace/newlines
      while (
        end < source.length &&
        (source[end] === '\n' || source[end] === '\r')
      ) {
        end++
      }
      dispatchFn({
        from: entry.sourceStart,
        to: end,
        insert: '',
      })
      setSelectedEntry(null)
      setMode('list')
    },
    [dispatchFn, source]
  )

  const value = useMemo(
    () => ({
      isBibFile,
      entries,
      selectedEntry,
      mode,
      source,
      setEditorState,
      selectEntry,
      setMode,
      saveEntry,
      addEntry,
      deleteEntry,
      registerDispatch,
    }),
    [
      isBibFile,
      entries,
      selectedEntry,
      mode,
      source,
      setEditorState,
      selectEntry,
      setMode,
      saveEntry,
      addEntry,
      deleteEntry,
      registerDispatch,
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
