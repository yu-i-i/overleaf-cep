import React, { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Panel, PanelGroup } from 'react-resizable-panels'
import OLButton from '@/shared/components/ol/ol-button'
import { HorizontalResizeHandle } from '@/features/ide-react/components/resize/horizontal-resize-handle'
import { HorizontalToggler } from '@/features/ide-react/components/resize/horizontal-toggler'
import { VerticalResizeHandle } from '@/features/ide-react/components/resize/vertical-resize-handle'
import { VerticalToggler } from './vertical-toggler'
import { ToolbarLayout } from '@/features/source-editor/components/toolbar/toolbar-layout'
import { isMac } from '@/shared/utils/os'

import { redo, undo } from '@codemirror/commands'
import { useCodeMirrorStateContext, useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useBibEditorContext } from '../context/bib-editor-context'
import GenericConfirmModal from '@/features/ide-react/components/modals/generic-confirm-modal'
import withErrorBoundary from '@/infrastructure/error-boundary'

import BibEntryList from './bib-entry-list'
import BibManualModal from './bib-manual-modal'
import BibEntryPreview from './bib-entry-preview'
import BibImportModal from './bib-import-modal'
import BibOrcidImportModal from './bib-orcid-import-modal'

import {
  downloadBibEntryFilename,
  downloadBibBulkFilename,
  matchesSearch,
  bulkDeleteIds,
  nextEntry,
  prevEntry,
} from '../utils/preview-model'
import BibEntryListPanel from './bib-entry-list-panel'
import BibBulkActionsBar from './bib-bulk-actions-bar'
import '../../stylesheets/bib-editor-panel.css'

import type { PositionedBibtexEntry } from '../utils/bib-types'
import type { BibListPosition } from '../utils/bib-list-position'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { fromBibFormString } from '../utils/bib-field-edit'
import { hasBalancedCurlyBraces } from '../utils/bib-validate'
import { plural } from '../utils/plural'
import { authorDraftSavedValue } from '../utils/bib-author-draft'
import { generateAvailableCitationKey } from '../utils/bib-key-generation'
import { canCommitDepartingDocument } from '../utils/bib-visual-exit'
import { commitBibKeyOnExit } from '../extensions/bib-editor-extension'
import {
  bibPreviewSessionKey,
  createBibPreviewSessionStore,
  resolveBibPreviewSession,
} from '../utils/bib-preview-session'
import type { BibAuthorDraft, BibNameDrafts } from '../utils/bib-author-draft'
import { isNameField } from '../utils/bib-types'
import {
  BIB_HISTORY_APPLIED_EVENT,
  BIB_REQUEST_STATE_EVENT,
  BIB_SCROLL_TO_EVENT,
} from '../utils/bib-editor-events'
import type { BibEntriesDetail, BibHistoryAppliedDetail } from '../utils/bib-editor-events'

const NARROW_LAYOUT_WIDTH = 600

function shallowEntriesEqual(a: BibtexEntry, b: BibtexEntry | undefined): boolean {
  return !!b && a.toString() === b.toString()
}

function pendingDraftKey(documentId: string | null, entryId: string): string {
  return JSON.stringify([documentId, entryId])
}

function BibEditorPanel() {
  const { t } = useTranslation()
  const {
    entries,
    entriesDocumentId,
    restoredSessionKey,
    setRestoredSessionKey,
    revision,
    entryIdRemaps,
    removedEntryIds,
    selection,
    writeFailure,
    selectEntry,
    deselect,
    writeEntry,
    importMany,
    deleteEntry,
    clearWriteFailure,
    bindEditorView,
    isCurrentEditorView,
  } = useBibEditorContext()
  const { showVisual } = useEditorPropertiesContext()
  // Read-only files use LayoutContext.view rather than currentDocumentId.
  // Observe this in the panel so returning to the same .bib file restores its list.
  const { view: layoutView } = useLayoutContext()
  const isFileView = layoutView === 'file'
  const { openDocName, currentDocumentId, currentDocument } = useEditorOpenDocContext()
  const { projectId } = useProjectContext()
  const { eventEmitter, permissionsLevel } = useIdeReactContext()
  const editorState = useCodeMirrorStateContext()
  const readOnly = permissionsLevel === 'readOnly' || editorState.readOnly
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const loadedDocumentId = currentDocument?.doc_id
  const documentJoined = currentDocument?.joined
  const loadedView = currentDocument?.cm6?.view
  const previewSessionKey = projectId && currentDocumentId
    ? bibPreviewSessionKey(String(projectId), String(currentDocumentId))
    : null

  // Keep a pending confirmation tied to the exact source entry and document.
  const [deleteTarget, setDeleteTarget] = useState<{
    documentId: string
    entryId: string
  } | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [orcidOpen, setOrcidOpen] = useState(false)
  const [manualShow, setManualShow] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const [narrowLayout, setNarrowLayout] = useState(false)

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const updateLayout = (width: number) =>
      setNarrowLayout(width <= NARROW_LAYOUT_WIDTH)

    updateLayout(editor.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      updateLayout(entry.contentRect.width)
    })
    observer.observe(editor)
    return () => observer.disconnect()
  }, [])

  const sessionStore = useMemo(() => previewSessionKey
    ? createBibPreviewSessionStore(previewSessionKey) : null, [previewSessionKey])
  const [listShown, setListShown] = useState(() => sessionStore?.read().listShown ?? true)
  // Shared by previews and the manual form, but never persisted between files.
  const [optionalExpanded, setOptionalExpanded] = useState(false)
  const getListPosition = useCallback(() => sessionStore?.read().listPosition ?? null, [sessionStore])

  useLayoutEffect(() => {
    if (!sessionStore) return
    const flush = sessionStore.flush
    window.addEventListener('pagehide', flush)
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
    }
  }, [sessionStore])

  useLayoutEffect(() => {
    if (!showVisual || isFileView) sessionStore?.flush()
  }, [sessionStore, showVisual, isFileView])
  const [draftReset, setDraftReset] = useState<{
    entryId: string
    version: number
    entry: BibtexEntry
  } | null>(null)
  const draftResetVersionRef = useRef(0)

  const [bulkDeleteGuard, setBulkDeleteGuard] = useState<
    { documentId: string; entryIds: string[] } | null
  >(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Preserve invalid author/editor rows while committing valid neighboring rows.
  const pendingDraftsRef = useRef(
    new Map<string, { entry: BibtexEntry; nameDrafts?: BibNameDrafts }>()
  )

  // History changes are authoritative source updates. Discard cached invalid
  // drafts for the affected occurrence so undo/redo is reflected in the form.
  useEffect(() => {
    const historyHandler = (event: Event) => {
      const detail = (event as CustomEvent<BibHistoryAppliedDetail>).detail
      if (
        !detail?.entryId ||
        !detail.entry ||
        !isCurrentEditorView(detail.view)
      ) {
        return
      }

      // Undo/redo is authoritative for the affected entry. Drop its entire
      // cached invalid draft instead of trying to merge selected changed fields:
      // the local invalid value was never part of CodeMirror's history.
      const affectedIds = [detail.entryId, detail.previousEntryId]
      for (const id of affectedIds) {
        if (id) pendingDraftsRef.current.delete(pendingDraftKey(currentDocumentId, id))
      }
      const currentSelection = selectionMirror.current
      if (
        currentSelection &&
        affectedIds.includes(currentSelection.entryId)
      ) {
        draftResetVersionRef.current++
        setDraftReset({
          entryId: detail.entryId,
          version: draftResetVersionRef.current,
          entry: detail.entry,
        })
      }
    }

    document.addEventListener(BIB_HISTORY_APPLIED_EVENT, historyHandler)
    return () => {
      document.removeEventListener(BIB_HISTORY_APPLIED_EVENT, historyHandler)
    }
  }, [isCurrentEditorView, currentDocumentId])

  // Cleanup and navigation effects read these mirrors so they can use the latest
  // selection/source without restarting on every React state change.
  const selectionMirror = useRef(selection)
  // A selection carried across a document switch must not write to the new file.
  const selectedDocumentIdRef = useRef<string | null>(
    restoredSessionKey === previewSessionKey ? currentDocumentId : null
  )
  const processedEntryIdentityChangesRef = useRef<{
    entryIdRemaps: typeof entryIdRemaps
    removedEntryIds: typeof removedEntryIds
  } | null>(null)
  const revisionMirror = useRef(revision)
  const entriesMirror = useRef<PositionedBibtexEntry[]>(entries)

  const view = useCodeMirrorViewContext()
  // An old form callback may run after the active document has changed.
  // Compare its captured document ID with the latest rendered document ID.
  const activeDocumentIdRef = useRef(currentDocumentId)
  activeDocumentIdRef.current = currentDocumentId
  // Invalidate callbacks immediately on render, before passive-effect cleanup.
  const activeVisualRef = useRef(false)
  activeVisualRef.current = showVisual && !isFileView && !readOnly

  // Current CodeMirror/OT attachment, independent of how the UI is presented.
  // Read live properties: a stale callback must not write after detachment.
  const isAttachedDocument = useCallback(() =>
    currentDocumentId != null &&
    activeDocumentIdRef.current === currentDocumentId &&
    loadedDocumentId === currentDocumentId &&
    !!currentDocument?.joined &&
    currentDocument?.cm6?.view === view,
  [currentDocumentId, loadedDocumentId, currentDocument, view])

  // Ordinary Visual mutations additionally require an active editable UI and
  // the view currently bound to the provider. Departure commits are separate.
  const canWriteToView = useCallback(() =>
    !readOnly && !view.state.readOnly &&
    showVisual && !isFileView && activeVisualRef.current &&
    isAttachedDocument() && isCurrentEditorView(view),
  [readOnly, showVisual, isFileView, isAttachedDocument, isCurrentEditorView, view])

  // The provider checks this same predicate for every mutation, including
  // asynchronous ORCID imports that bypass the panel's form callbacks.
  useLayoutEffect(() => {
    bindEditorView(view, canWriteToView)
    return () => bindEditorView(null)
  }, [bindEditorView, view, canWriteToView])

  // Route shortcuts originating inside the active bibliography UI to CodeMirror.
  // Search and owned dialogs (including portals) retain native text undo/redo.
  useEffect(() => {
    if (!showVisual || isFileView) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canWriteToView() || event.defaultPrevented) return
      const target = event.target
      if (!(target instanceof Element)) return
      const dialog = target.closest('[role="dialog"]')
      if (!editorRef.current?.contains(target) &&
          !dialog?.hasAttribute('data-bib-editor-dialog')) return
      const key = typeof event.key === 'string' ? event.key.toLowerCase() : ''
      const modifier = isMac ? event.metaKey : event.ctrlKey
      const isUndo = modifier && key === 'z' && !event.shiftKey
      const isRedo =
        modifier &&
        (isMac
          ? key === 'z' && event.shiftKey
          : key === 'y' || (key === 'z' && event.shiftKey))

      if (!isUndo && !isRedo) return

      // Keep native undo/redo in search and modal inputs, while preventing
      // the IDE's global shortcut handlers from handling the same keystroke.
      if (
        dialog || target.id === 'bibtex-list-search'
      ) {
        event.stopImmediatePropagation()
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      if (isUndo) undo(view)
      else redo(view)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [showVisual, isFileView, canWriteToView, view])

  useLayoutEffect(() => {
    const previousIdentityChanges = processedEntryIdentityChangesRef.current
    const hasIdentityChanges =
      entryIdRemaps.length > 0 || removedEntryIds.length > 0
    const identityChangesAreNew =
      previousIdentityChanges?.entryIdRemaps !== entryIdRemaps ||
      previousIdentityChanges?.removedEntryIds !== removedEntryIds

    if (hasIdentityChanges && identityChangesAreNew) {
      processedEntryIdentityChangesRef.current = {
        entryIdRemaps,
        removedEntryIds,
      }
      const idMap = new Map(
        entryIdRemaps.map(remap => [remap.previousEntryId, remap.entryId] as const)
      )
      const removedIds = new Set(removedEntryIds)
      const draftMoves = entryIdRemaps.map(remap => ({
        oldKey: pendingDraftKey(currentDocumentId, remap.previousEntryId),
        newKey: pendingDraftKey(currentDocumentId, remap.entryId),
        draft: pendingDraftsRef.current.get(
          pendingDraftKey(currentDocumentId, remap.previousEntryId)
        ),
      }))

      for (const move of draftMoves) {
        pendingDraftsRef.current.delete(move.oldKey)
      }
      for (const removedId of removedEntryIds) {
        pendingDraftsRef.current.delete(pendingDraftKey(currentDocumentId, removedId))
      }
      for (const move of draftMoves) {
        if (move.draft) pendingDraftsRef.current.set(move.newKey, move.draft)
      }

      setSelectedIds(prev => {
        const next = prev.flatMap(id => {
          const remappedId = idMap.get(id)
          if (remappedId) return [remappedId]
          return removedIds.has(id) ? [] : [id]
        })
        const unique = [...new Set(next)]
        return unique.length === prev.length &&
          unique.every((id, index) => id === prev[index])
          ? prev
          : unique
      })
      setBulkDeleteGuard(prev => {
        if (!prev) return prev
        const entryIds = prev.entryIds.flatMap(id => {
          const remappedId = idMap.get(id)
          if (remappedId) return [remappedId]
          return removedIds.has(id) ? [] : [id]
        })
        return entryIds.length === prev.entryIds.length &&
          entryIds.every((id, index) => id === prev.entryIds[index])
          ? prev
          : entryIds.length > 0 ? { ...prev, entryIds } : null
      })
      setDraftReset(prev => {
        if (!prev) return prev
        const entryId = idMap.get(prev.entryId)
        if (entryId) return { ...prev, entryId }
        return removedIds.has(prev.entryId) ? null : prev
      })
    }
    selectionMirror.current = selection
  }, [selection, entryIdRemaps, removedEntryIds, currentDocumentId])

  // Event callbacks need the latest source revision and parsed ranges.
  useLayoutEffect(() => {
    revisionMirror.current = revision
    entriesMirror.current = entries
  }, [revision, entries])


  // A keyless entry keeps its generated placeholder while the preview is open.
  // Commit on explicit Close/navigation, or when the preview is actually removed.
  // Only dispatch while the departing document still owns CodeMirror and OT.
  const commitSelectedKey = useCallback((documentId: string | null) => {
    if (readOnlyRef.current || view.state.readOnly ||
        !documentId || selectedDocumentIdRef.current !== documentId) return
    const sel = selectionMirror.current
    if (!sel) return
    const draft = pendingDraftsRef.current.get(
      pendingDraftKey(documentId, sel.entryId)
    )?.entry
    commitBibKeyOnExit(view, sel.entryId, draft)
  }, [view])

  const commitKeyOnLeave = useCallback(() => {
    if (canWriteToView()) commitSelectedKey(currentDocumentId)
  }, [canWriteToView, commitSelectedKey, currentDocumentId])


  const handleFormChange = useCallback(
    (
      entry: BibtexEntry,
      historyUserEvent: 'input.type' | 'input.complete' | 'delete' = 'input.type',
      fieldIsValid = true,
      fieldTarget?: import('../context/bib-editor-context').BibFieldWriteTarget,
      draftIsValid = true,
      nameDraft?: BibAuthorDraft
    ) => {
      if (!canWriteToView()) return
      const sel = selectionMirror.current
      if (!sel) return

      const draftKey = pendingDraftKey(currentDocumentId, sel.entryId)
      const previous = pendingDraftsRef.current.get(draftKey)
      const nameField = fieldTarget?.kind === 'field' &&
        isNameField(fieldTarget.name)
        ? fieldTarget.name
        : null
      const nameDrafts: BibNameDrafts = { ...previous?.nameDrafts }
      if (nameField) {
        if (fieldIsValid) delete nameDrafts[nameField]
        else if (nameDraft) nameDrafts[nameField] = nameDraft
      }
      const pending = { entry, nameDrafts }
      pendingDraftsRef.current.set(draftKey, pending)
      if (!fieldIsValid && !(nameField && nameDraft)) return

      const parsed = entriesMirror.current.find(
        candidate => candidate.entry.id === sel.entryId
      )
      if (parsed && shallowEntriesEqual(entry, parsed.entry) && !fieldTarget) return

      // A malformed name row retains its last writable value in the source.
      // Other rows (including moves and deletions) can still be committed.
      const savedNames = nameDraft && authorDraftSavedValue(nameDraft)
      // A malformed name row may retain an older, source-preserving value.
      // Do not submit it if the combined saved rows are still unbalanced:
      // the write planner would reject the field and show a misleading
      // 'file changed' banner. Retain the draft until a safe write is possible.
      if (nameField && savedNames !== undefined && !hasBalancedCurlyBraces(savedNames)) {
        return
      }
      const writableEntry = nameField && savedNames !== undefined
        ? savedNames
          ? entry.setField(nameField, fromBibFormString(savedNames, nameField))
          : entry.deleteField(nameField)
        : entry
      if (nameField && nameDraft && parsed &&
          writableEntry.getField(nameField).toString() ===
            parsed.entry.getField(nameField).toString()) {
        if (draftIsValid) pendingDraftsRef.current.delete(draftKey)
        return
      }

      const accepted = writeEntry({
        entry: writableEntry,
        mode: 'existing',
        entryId: sel.entryId,
        historyUserEvent,
        fieldTarget,
      })
      if (accepted && draftIsValid) {
        pendingDraftsRef.current.delete(draftKey)
      } else {
        pendingDraftsRef.current.set(draftKey, pending)
      }
    },
    [writeEntry, currentDocumentId, canWriteToView]
  )

  const commitDepartingPreview = useCallback(
    (owner: NonNullable<typeof currentDocument>) => {
      if (canCommitDepartingDocument(owner, view)) {
        commitSelectedKey(owner.doc_id)
      }
    },
    [view, commitSelectedKey]
  )

  // This event fires synchronously before openDoc() detaches the old OT
  // document. Keep one listener for the panel lifetime: a passive effect that
  // is removed/reinstalled on document updates can miss rapid navigation.
  // Update the owner in a layout effect so the listener uses the last committed
  // attachment, never a stale file or an unfinished React render.
  const departingPreviewRef = useRef<{
    owner: NonNullable<typeof currentDocument>
    commit: (owner: NonNullable<typeof currentDocument>) => void
  } | null>(null)

  useLayoutEffect(() => {
    // Keep the departing document while the binary-file viewer takes over.
    if (isFileView) return
    departingPreviewRef.current =
      showVisual && currentDocument && isAttachedDocument()
        ? { owner: currentDocument, commit: commitDepartingPreview }
        : null
  })

  // Both navigation paths commit the same departing preview. Their signals
  // differ because Overleaf opens docs and binary files differently.
  const commitOnNavigation = useCallback(() => {
    const departing = departingPreviewRef.current
    if (departing) departing.commit(departing.owner)
  }, [])

  useLayoutEffect(() => {
    eventEmitter.on('store-doc-position', commitOnNavigation)
    return () => eventEmitter.off('store-doc-position', commitOnNavigation)
  }, [eventEmitter, commitOnNavigation])

  useLayoutEffect(() => {
    if (isFileView) commitOnNavigation()
  }, [isFileView, commitOnNavigation])

  // Code-mode switching does not open a new document. The Visual component
  // unmounts while the original CodeMirror/ShareJS attachment is still alive.
  // If the file ID changed, do NOT write here: the pre-open listener above
  // already committed it before Overleaf began leaving the old document.
  useLayoutEffect(() => {
    if (!showVisual || !currentDocument || !documentJoined ||
        loadedDocumentId !== currentDocumentId || loadedView !== view) return

    const departingDocumentId = currentDocumentId
    return () => {
      // A same-ID attachment refresh may replace the document object without
      // closing the preview. Use the last committed owner, not the old closure.
      const departing = departingPreviewRef.current
      if (activeDocumentIdRef.current === departingDocumentId &&
          departing?.owner.doc_id === departingDocumentId) {
        departing.commit(departing.owner)
      }
      // The extension resolves the entry's current range, not a stale offset.
      const sel = selectionMirror.current
      if (sel) document.dispatchEvent(new CustomEvent(BIB_SCROLL_TO_EVENT, {
        detail: { view, entryId: sel.entryId },
      }))
    }
    // The attachment and mode define this lifetime. Updating the object for
    // the same attached document must not close its preview or commit a key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVisual, currentDocumentId, documentJoined, loadedView, view])

  const prevDocumentId = useRef(currentDocumentId)

  // Drop the previous document's drafts and selection when its ID changes.
  // The draft cache uses document IDs, never potentially identical filenames.
  useEffect(() => {
    if (currentDocumentId !== prevDocumentId.current) {
      pendingDraftsRef.current.clear()
      setOptionalExpanded(false)
      setRestoredSessionKey(null)
      if (prevDocumentId.current !== null) {
        selectedDocumentIdRef.current = null
        deselect()
        setBulkDeleteGuard(null)
        setDeleteTarget(null)
        setSelectedIds([])
      }
    }
    prevDocumentId.current = currentDocumentId
  }, [currentDocumentId, deselect, setRestoredSessionKey])

  // The provider keeps the last projection with its document ID. Restoring from
  // that state works even when CodeMirror published it before this panel mounted
  // (as can happen when returning from a read-only file viewer).
  // A document session is initialized once. Merely covering it with a
  // read-only tab must not reselect/remount its live preview.
  useEffect(() => {
    if (!showVisual || isFileView || !previewSessionKey || !currentDocumentId ||
        entriesDocumentId !== currentDocumentId ||
        restoredSessionKey === previewSessionKey) return

    const saved = sessionStore?.read() ?? null
    const { entry, listShown: savedListShown } = resolveBibPreviewSession(saved, entries)
    if (entry) selectEntry(entry)
    else deselect()
    selectedDocumentIdRef.current = entry ? currentDocumentId : null
    setListShown(savedListShown)
    setRestoredSessionKey(previewSessionKey)
  }, [showVisual, isFileView, previewSessionKey, currentDocumentId, entriesDocumentId,
    restoredSessionKey, entries, selectEntry, deselect, sessionStore, setRestoredSessionKey])

  // A projection update is independent of restoration. Ask for a fresh parse
  // when an attached document enters Visual mode, but do not rely on the
  // response being delivered after the panel's effects have subscribed.
  useEffect(() => {
    if (!showVisual || !currentDocumentId || !documentJoined ||
        loadedDocumentId !== currentDocumentId || loadedView !== view) return
    document.dispatchEvent(new CustomEvent(BIB_REQUEST_STATE_EVENT, { detail: { view } }))
  }, [showVisual, currentDocumentId, documentJoined, loadedDocumentId, loadedView, view])

  // One persistence path for clicks, close, list toggles and provider remaps.
  // A hidden tab may still receive authoritative source updates.
  useLayoutEffect(() => {
    if (restoredSessionKey !== previewSessionKey ||
        entriesDocumentId !== currentDocumentId ||
        (selection && selectedDocumentIdRef.current !== currentDocumentId)) return
    const saved = sessionStore?.read()
    const entryId = selection?.entryId ?? null
    const entryFrom = selection?.from ?? null
    const shown = selection ? listShown : true
    if (saved?.entryId !== entryId || saved?.entryFrom !== entryFrom ||
        saved?.listShown !== shown) {
      sessionStore?.update({ entryId, entryFrom, listShown: shown })
    }
  }, [selection, listShown, restoredSessionKey, previewSessionKey,
    entriesDocumentId, currentDocumentId, sessionStore])

  const handleListPositionChange = useCallback((position: BibListPosition) => {
    if (isFileView || !previewSessionKey || restoredSessionKey !== previewSessionKey) return
    sessionStore?.update({ listPosition: position }, true)
  }, [isFileView, previewSessionKey, restoredSessionKey, sessionStore])

  // A departing selection must not supply ranges for the incoming document.
  // The selection is also cleared by an effect, but that runs after rendering.
  const previewBelongsToDocument =
    selectedDocumentIdRef.current === currentDocumentId && isAttachedDocument()
  const previewIndex = useMemo(
    () => previewBelongsToDocument && selection
      ? entries.findIndex(e => e.entry.id === selection.entryId)
      : -1,
    [previewBelongsToDocument, selection, entries]
  )
  const previewEntry = previewIndex >= 0 ? entries[previewIndex] : null

  const previousSelection = selectionMirror.current
  const previewDraftRemap = previewEntry
    ? entryIdRemaps.find(remap =>
        remap.entryId === previewEntry.entry.id && remap.from === previewEntry.from
      )
    : undefined
  const previewDraft = previewEntry
    ? pendingDraftsRef.current.get(pendingDraftKey(currentDocumentId, previewEntry.entry.id)) ??
      (previewDraftRemap
        ? pendingDraftsRef.current.get(
            pendingDraftKey(currentDocumentId, previewDraftRemap.previousEntryId)
          )
        : selection &&
          previousSelection &&
          previousSelection.from === previewEntry.from
            ? pendingDraftsRef.current.get(
                pendingDraftKey(currentDocumentId, previousSelection.entryId)
              )
            : undefined)
    : undefined

  const handlePreviewClose = useCallback(() => {
    commitKeyOnLeave()
    setDeleteTarget(null)
    deselect()
    selectedDocumentIdRef.current = null
    setListShown(true)
  }, [commitKeyOnLeave, deselect])

  const handleSelectEntry = useCallback((next: PositionedBibtexEntry) => {
    if (selectionMirror.current?.entryId === next.entry.id) return
    // Select first: the synchronous key write can remap the next entry's ID
    // when a previous keyless occurrence stops sharing its empty-key group.
    selectEntry(next)
    selectedDocumentIdRef.current = currentDocumentId
    commitKeyOnLeave()
  }, [commitKeyOnLeave, selectEntry, currentDocumentId])

  // Navigate by current parsed order; local invalid drafts remain cached by id.
  const handlePrev = useCallback(() => {
    const prev = prevEntry(entries, previewIndex)

    if (
      !prev ||
      (selection &&
        prev.entry.id === selection.entryId)
    ) {
      return
    }

    handleSelectEntry(prev)
  }, [previewIndex, entries, selection, handleSelectEntry])

  const handleNext = useCallback(() => {
    const next = nextEntry(entries, previewIndex)

    if (
      !next ||
      (selection &&
        next.entry.id === selection.entryId)
    ) {
      return
    }

    handleSelectEntry(next)
  }, [previewIndex, entries, selection, handleSelectEntry])


  /**
   * Check in the manual-entry modal must stay busy until the save boundary has
   * completed. The current DOM-event write is synchronous, so this resolves
   * immediately; the Promise-based contract also handles a future async writer.
   */
  const handleChecked = useCallback(
    async (entry: BibtexEntry): Promise<boolean> => {
      if (!canWriteToView()) return false

      // The form validates required fields and nonempty keys. Generate a key
      // for an empty draft before the writer validates and appends the entry.
      const finalEntry = entry.setKey(entry.key.trim() || generateAvailableCitationKey(
        entry, entriesMirror.current.map(item => item.entry.key), ''
      ))
      return writeEntry({
        entry: finalEntry,
        mode: 'new',
        expectedRevision: revisionMirror.current,
        expectedDocument: view.state.doc,
      })
    },
    [view, writeEntry, canWriteToView]
  )

  // Delete actions resolve their source ranges against the current document.

  const handleConfirmDelete = useCallback(() => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (target?.documentId !== currentDocumentId) return
    if (!canWriteToView()) return
    const sel = selectionMirror.current
    if (sel && sel.entryId === target.entryId) {
      deleteEntry({ entryId: target.entryId })
    }
    // Source updates remove the selection and form only if deletion succeeded.
  }, [currentDocumentId, deleteEntry, deleteTarget, canWriteToView])

  // The confirmation stores current entry ids; the extension resolves their
  // source ranges when the user confirms deletion.
  const handleAskBulkDelete = useCallback(() => {
    if (!canWriteToView() || !currentDocumentId) return
    setBulkDeleteGuard({
      documentId: currentDocumentId,
      entryIds: bulkDeleteIds(entriesMirror.current, selectedIds),
    })
  }, [canWriteToView, currentDocumentId, selectedIds])

  const handleConfirmBulkDelete = useCallback(() => {
    const guard = bulkDeleteGuard
    setBulkDeleteGuard(null)

    if (!guard || guard.documentId !== currentDocumentId || !canWriteToView()) return

    deleteEntry({ entryIds: guard.entryIds })
    // Deleted rows are removed from the selection by the source-update handler.
  }, [deleteEntry, bulkDeleteGuard, currentDocumentId, canWriteToView])

  // All import sources share this optimistic-concurrency guard. The extension
  // rechecks the document/revision immediately before applying the batch append.
  const appendImportedEntries = useCallback(
    (entries: BibtexEntry[]): boolean => {
      if (!canWriteToView()) return false
      return importMany({
        entries,
        expectedRevision: revisionMirror.current,
        expectedDocument: view.state.doc,
      })
    },
    [importMany, view, canWriteToView]
  )

  // Close the paste-import modal only after the guarded append succeeds.
  const handleImportEntries = useCallback(
    async (importEntries: BibtexEntry[]): Promise<boolean> => {
      const accepted = appendImportedEntries(importEntries)
      if (accepted) setImportOpen(false)
      return accepted
    },
    [appendImportedEntries]
  )

  const downloadText = useCallback((text: string, filename: string) => {
    const blob = new Blob([text], {
      type: 'text/plain',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Browsers may start reading the blob URL after click() returns.
    // Revoke it only after the download has had time to start.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  // A single-entry download contains exactly the entry currently shown.
  const handleDownload = useCallback(() => {
    const entry = selectionMirror.current
      ? entriesMirror.current.find(
          e => e.entry.id === selectionMirror.current?.entryId
        )
      : null
    if (!entry) return

    downloadText(
      view.state.doc.sliceString(entry.from, entry.to),
      downloadBibEntryFilename(entry.entry.key)
    )
  }, [downloadText, view])

  // Bulk download preserves document order and writes one partial BibTeX file.
  const handleBulkDownload = useCallback(() => {
    const selected = new Set(selectedIds)
    const selectedEntries = entriesMirror.current.filter(entry =>
      selected.has(entry.entry.id)
    )
    if (selectedEntries.length === 0) return

    const text = selectedEntries
      .map(entry => view.state.doc.sliceString(entry.from, entry.to))
      .join('\n')

    downloadText(text, downloadBibBulkFilename(openDocName))
  }, [downloadText, openDocName, selectedIds, view])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const selected = new Set(prev)
      if (selected.has(id)) {
        selected.delete(id)
      } else {
        selected.add(id)
      }
      return [...selected]
    })
  }, [])

  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return entries.filter(e => matchesSearch(e, search))
  }, [entries, search])

  // A selection cannot outlive its visibility, including when edits change
  // search matches without changing the search text itself.
  useEffect(() => {
    setSelectedIds(prev => {
      const next = bulkDeleteIds(filtered, prev)
      return next.length === prev.length ? prev : next
    })
  }, [filtered])

  const handleToggleSelectAll = useCallback(
    (kind: 'all' | 'none') => {
      setSelectedIds(
        kind === 'all' ? filtered.map(e => e.entry.id) : []
      )
    },
    [filtered]
  )

  const entryKeys = useMemo(() => entries.map(e => e.entry.key), [entries])

  const duplicateEntryStarts = useMemo(() => {
    const firstOccurrence = new Map<string, string>()
    const duplicates = new Set<string>()
    for (const item of entries) {
      const key = item.entry.key.trim()
      if (!key) continue
      const first = firstOccurrence.get(key)
      if (first !== undefined) {
        duplicates.add(first)
        duplicates.add(item.entry.id)
      } else {
        firstOccurrence.set(key, item.entry.id)
      }
    }
    return duplicates
  }, [entries])

  const handleSearchChange = useCallback((value: string) => {
    setSelectedIds(prev => prev.length > 0 ? [] : prev)
    setSearch(value)
  }, [])

  const openImport = useCallback(() => setImportOpen(true), [])
  const openManual = useCallback(() => setManualShow(true), [])
  const openOrcid = useCallback(() => {
    if (currentDocumentId) setOrcidOpen(true)
  }, [currentDocumentId])
  const closeManual = useCallback(() => setManualShow(false), [])
  const askDeleteEntry = useCallback(() => {
    const sel = selectionMirror.current
    if (sel && currentDocumentId) {
      setDeleteTarget({ documentId: currentDocumentId, entryId: sel.entryId })
    }
  }, [currentDocumentId])
  const bulkDeleteCount = bulkDeleteGuard?.entryIds.length ?? 0

  return (
    <div
      ref={editorRef}
      className="bibtex-visual-editor"
    >

      {writeFailure !== null && (
        <div className="bibtex-write-failure-banner" role="alert">
          <span className="bibtex-write-failure-banner-text">
            {t('could_not_save_bib_file')}
          </span>
          <OLButton
            type="button"
            size="sm"
            variant="danger"
            aria-label={t('close')}
            onClick={e => {
              e.stopPropagation()
              clearWriteFailure()
            }}
          >
            {t('close')}
          </OLButton>
        </div>
      )}

      <div className="bibtex-toolbar">
        <ToolbarLayout.Left canEdit={!readOnly} />
        <ToolbarLayout.Right canUseWritefull={false} />
      </div>

      <PanelGroup
        autoSaveId={
          narrowLayout ? 'ide-redesign-bibtex-vertical' : 'ide-redesign-bibtex'
        }
        direction={narrowLayout ? 'vertical' : 'horizontal'}
        className="bibtex-list-and-preview"
      >
        {(listShown || !previewEntry) && (
          <Panel
            className="bibtex-scroll-panel"
            id="id-bibtex-entry-list"
            order={1}
            minSize={20}
          >
            <BibEntryListPanel
              readOnly={readOnly}
              search={search}
              onSearchChange={handleSearchChange}
              openDocName={openDocName}
              onAddPaste={openImport}
              onAddManual={openManual}
              onAddFromOrcid={openOrcid}
            />
            <BibBulkActionsBar
              filteredLength={filtered.length}
              allSelected={filtered.length > 0 && filtered.every(e => selectedIdSet.has(e.entry.id))}
              selectedIds={selectedIds}
              onToggleSelectAll={handleToggleSelectAll}
              onBulkDelete={
                !readOnly && selectedIds.length > 0
                  ? handleAskBulkDelete
                  : undefined
              }
              onBulkDownload={
                selectedIds.length > 0
                  ? handleBulkDownload
                  : undefined
              }
            />
            <BibEntryList
              entries={filtered}
              existingIds={entryKeys}
              onSelect={handleSelectEntry}
              restoreKey={!isFileView && restoredSessionKey === previewSessionKey && restoredSessionKey
                ? restoredSessionKey
                : null}
              getRestorePosition={getListPosition}
              onPositionChange={handleListPositionChange}
              previewId={
                selection
                  ? selection.entryId
                  : null
              }
              duplicateIds={duplicateEntryStarts}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              search={search}
              totalEntries={entries.length}
            />
          </Panel>
        )}
        {previewEntry && (
          narrowLayout ? (
            listShown && (
              <div className="bibtex-vertical-resize-controls">
                <VerticalResizeHandle id="ide-redesign-bibtex" />
                <VerticalToggler
                  id="ide-redesign-bibtex-vertical-toggler"
                  onClick={() => setListShown(false)}
                  tooltip={t('tooltip_hide_panel')}
                />
              </div>
            )
          ) : (
            listShown && (
              <HorizontalResizeHandle id="ide-redesign-bibtex">
                <HorizontalToggler
                  id="ide-redesign-pdf-panel"
                  togglerType="west"
                  isOpen={listShown}
                  setIsOpen={setListShown}
                  tooltipWhenOpen={t('tooltip_hide_panel')}
                  tooltipWhenClosed={t('tooltip_show_panel')}
                />
              </HorizontalResizeHandle>
            )
          )
        )}
        {selection && previewEntry && (
          <Panel
            className="bibtex-scroll-panel"
            id="id-bibtex-entry-preview"
            order={2}
            defaultSize={40}
            minSize={20}
          >
            <BibEntryPreview
              key={`${projectId}:${currentDocumentId}:${selection.previewId}`}
              entries={entries}
              entry={previewEntry}
              sourceText={view.state.doc.sliceString(previewEntry.from, previewEntry.to)}
              draftEntry={previewDraft?.entry}
              pendingNameDrafts={previewDraft?.nameDrafts}
              draftReset={
                draftReset?.entryId === previewEntry.entry.id
                  ? draftReset
                  : undefined
              }
              previewIndex={previewIndex}
              onPrev={handlePrev}
              onNext={handleNext}
              onClose={handlePreviewClose}
              onDownload={handleDownload}
              onDelete={askDeleteEntry}
              onFormChange={handleFormChange}
              existingIds={entryKeys}
              canDelete={!readOnly}
              readOnly={readOnly}
              optionalExpanded={optionalExpanded}
              onOptionalExpandedChange={setOptionalExpanded}
            />
          </Panel>
        )}
        </PanelGroup>

      <GenericConfirmModal
        show={!readOnly && deleteTarget !== null && deleteTarget.documentId === currentDocumentId}
        onHide={() => setDeleteTarget(null)}
        title={t('delete_entry')}
        message={t('confirm_delete_entry')}
        confirmLabel={t('delete')}
        primaryVariant="danger"
        onConfirm={handleConfirmDelete}
      />

      <GenericConfirmModal
        show={bulkDeleteGuard !== null && bulkDeleteGuard.documentId === currentDocumentId && canWriteToView()}
        onHide={() => setBulkDeleteGuard(null)}
        title={plural(t, bulkDeleteCount, 'delete_entry', 'delete_entries')}
        message={plural(
          t,
          bulkDeleteCount,
          'confirm_delete_entry',
          'confirm_delete_references_count'
        )}
        confirmLabel={t('delete')}
        primaryVariant="danger"
        onConfirm={handleConfirmBulkDelete}
      />

      <BibImportModal
        show={importOpen && !readOnly}
        onImport={handleImportEntries}
        onHidden={() => setImportOpen(false)}
      />

      <BibManualModal
        show={manualShow && !readOnly}
        existingIds={entryKeys}
        onSave={handleChecked}
        onHide={closeManual}
        optionalExpanded={optionalExpanded}
        onOptionalExpandedChange={setOptionalExpanded}
      />

      <BibOrcidImportModal
        show={orcidOpen && !readOnly}
        onHide={() => setOrcidOpen(false)}
      />
    </div>
  )
}

function BibEditorFallback() {
  const { t } = useTranslation()

  return (
    <div className="bibtex-visual-editor">
      <div className="bibtex-editor-placeholder">
        {t('bibliography_editor_load_error')}
      </div>
    </div>
  )
}

export default withErrorBoundary(BibEditorPanel, () => <BibEditorFallback />)
