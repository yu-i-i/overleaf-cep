/** DOM event names and payload contracts shared by React and CodeMirror. */
import type { EditorView } from '@codemirror/view'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import type { PositionedBibtexEntry } from './bib-types'
import type { BibFieldWriteTarget } from './bib-write'

export const BIB_ENTRIES_EVENT = 'bib-editor:entries-updated'
export const BIB_WRITE_EVENT = 'bib-editor:write'
export const BIB_DELETE_EVENT = 'bib-editor:delete'
export const BIB_IMPORT_EVENT = 'bib-editor:import'
export const BIB_SCROLL_TO_EVENT = 'bib-editor:scroll-to'
export const BIB_WRITE_FAILED_EVENT = 'bib-editor:write-failed'
export const BIB_HISTORY_STATE_EVENT = 'bib-editor:history-state'
export const BIB_HISTORY_APPLIED_EVENT = 'bib-editor:history-applied'
export const BIB_REQUEST_STATE_EVENT = 'bib-editor:request-state'

export type BibEntryIdRemap = {
  previousEntryId: string
  entryId: string
  from: number
}

export type BibHistoryUserEvent = 'input.type' | 'input.complete' | 'delete'

export type BibWriteRequest = {
  entry: BibtexEntry
  mode: 'existing' | 'new'
  expectedRevision?: number
  expectedDocument?: unknown
  /** Current key-plus-occurrence-index id of the existing entry. */
  entryId?: string
  /** Reject a write if the source entry has changed since the Visual action. */
  expectedEntry?: BibtexEntry
  historyUserEvent?: BibHistoryUserEvent
  /** Exact target of a visual field/header edit. */
  fieldTarget?: BibFieldWriteTarget
}

export type BibDeleteRequest = {
  entryId?: string
  entryIds?: string[]
}

export type BibImportRequest = {
  entries: BibtexEntry[]
  expectedRevision: number
  expectedDocument: unknown
}

/** Events are scoped to the CodeMirror view that owns the document. */
export type BibEntriesDetail = {
  documentId: string | null
  isBibFile: boolean
  entries: PositionedBibtexEntry[]
  revision: number
  entryIdRemaps?: BibEntryIdRemap[]
  removedEntryIds?: string[]
  view: EditorView
}

export type BibHistoryStateDetail = {
  canUndo: boolean
  canRedo: boolean
  view: EditorView
}

export type BibWriteFailureDetail = {
  reason: string
  view: EditorView
}

export type BibHistoryAppliedDetail = {
  kind: 'undo' | 'redo'
  entryId?: string
  previousEntryId?: string
  entry?: BibtexEntry
  view: EditorView
}

/**
 * A cancelable DOM event alone cannot confirm a write: dispatchEvent() returns
 * true even with no listener. Only the owning CodeMirror plugin may acknowledge
 * a request, after applying its transaction (or accepting a legitimate no-op).
 */
export function dispatchBibMutation(
  eventName: typeof BIB_WRITE_EVENT | typeof BIB_IMPORT_EVENT,
  request: BibWriteRequest | BibImportRequest,
  view: EditorView
): boolean {
  const detail = { ...request, view, accepted: false }
  const event = new CustomEvent(eventName, { detail, cancelable: true })
  return document.dispatchEvent(event) && detail.accepted
}
