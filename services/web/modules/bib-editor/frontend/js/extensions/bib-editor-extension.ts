/**
 * CodeMirror integration for the visual BibTeX editor.
 *
 * CodeMirror remains authoritative. Visual edits are applied as small changes
 * to the affected field/header, while this plugin owns the current source range
 * for every entry occurrence. Entry ids are derived from citation key and
 * occurrence index, with explicit remaps for targeted visual edits.
 */
import { Annotation, Extension, Facet, Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { undoDepth, redoDepth } from '@codemirror/commands'
import { parseBibFile, parseBibEntryAt, parseBibEntryInRange } from '../utils/bib-entry-position'
import { keyToCommitOnLeave } from '../utils/bib-key-generation'
import type { BibProjectedEntry } from '../utils/bib-entry-position'
import { validateBibSource } from '../utils/bib-source-diagnostics'
import type { BibSourceDiagnostic } from '../utils/bib-source-diagnostics'
import {
  getBibEntryDiagnostics,
  setBibEntryDiagnostics,
} from '../utils/bib-entry-diagnostics'
import { PositionedBibtexEntry } from '@/features/bibtex/positioned-bibtex-entry'
import {
  planBibWrite,
  planBibFieldWrite,
  planBibBulkDelete,
  planBibImport,
  type BibFieldWriteTarget,
} from '../utils/bib-write'
import type { BibtexEntry } from '@shared/bibtex/bibtex-entry.mts'
import { updateOccurrenceIndexes, nearestEntryAt, getEntryIdentityChanges } from '../utils/bib-editor-identity'
import type { PreviousBibEntryIdentity, BibEntryIdentityChanges } from '../utils/bib-editor-identity'

import {
  BIB_ENTRIES_EVENT,
  BIB_WRITE_EVENT,
  BIB_DELETE_EVENT,
  BIB_IMPORT_EVENT,
  BIB_SCROLL_TO_EVENT,
  BIB_WRITE_FAILED_EVENT,
  BIB_HISTORY_STATE_EVENT,
  BIB_HISTORY_APPLIED_EVENT,
  BIB_REQUEST_STATE_EVENT,
} from '../utils/bib-editor-events'
import type { BibEntryIdRemap, BibHistoryUserEvent } from '../utils/bib-editor-events'

export {
  BIB_ENTRIES_EVENT,
  BIB_WRITE_EVENT,
  BIB_DELETE_EVENT,
  BIB_IMPORT_EVENT,
  BIB_SCROLL_TO_EVENT,
  BIB_WRITE_FAILED_EVENT,
  BIB_HISTORY_STATE_EVENT,
  BIB_HISTORY_APPLIED_EVENT,
  BIB_REQUEST_STATE_EVENT,
} from '../utils/bib-editor-events'

type BibVisualTarget = {
  mode: 'existing' | 'new'
  entryId?: string
  sourceStart?: number
  /** Guarded field/header write; only this path can use the known entry range. */
  local?: boolean
}

export const BIB_VISUAL_TARGET = Annotation.define<BibVisualTarget>()

// Bind each projection to the OT document that created this CodeMirror state.
const bibDocumentId = Facet.define<string | null, string | null>({
  combine: values => values[0] ?? null,
})

/**
 * Bridges one CodeMirror bibliography document and the React visual editor.
 *
 * The central invariant is that `this.view.state.doc` is authoritative. The
 * cached `entries` array is only a parsed projection for rendering and for
 * preserving entry identity across CodeMirror transactions.
 */
class BibEditorPlugin {
  private entries: PositionedBibtexEntry[] = []
  private dispatchHandler: ((ev: Event) => void) | null = null
  private scrollHandler: ((ev: Event) => void) | null = null
  private cancelScrollAlignment: (() => void) | null = null
  private requestStateHandler: ((ev: Event) => void) | null = null
  private destroyed = false
  private readonly documentId: string | null
  private revision = 0
  private diagnostics: BibSourceDiagnostic[] = []
  private validationTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private view: EditorView) {
    this.documentId = view.state.facet(bibDocumentId)
    this.setupDispatchListener()
    this.setupScrollListener()
    const source = this.view.state.doc.toString()
    this.entries = this.parseEntries(source)
    updateOccurrenceIndexes(this.entries)
    this.diagnostics = validateBibSource(source)
    this.emitState()
    this.emitHistoryState()
  }

  /** Write a departing preview's key against the current plugin projection.
   * Called only after the host verifies that this document still owns OT.
   * Never invoked by ordinary Code-mode edits or source parsing.
   */
  commitKeyOnExit(entryId: string, draft?: BibtexEntry): void {
    if (this.destroyed || this.view.state.readOnly) return
    const current = this.entries.find(item => item.entry.id === entryId)
    if (!current) return
    const key = keyToCommitOnLeave(
      current,
      this.entries.map(item => item.entry.key),
      draft
    )
    if (!key) return
    const source = this.view.state.doc.toString()
    const guard = planBibFieldWrite(
      source.slice(current.from, current.to),
      current.entry.setKey(key),
      { kind: 'citation-key' }
    )
    if (!guard.ok) return
    this.view.dispatch({
      changes: {
        from: current.from + guard.plan.from,
        to: current.from + guard.plan.to,
        insert: guard.plan.insert,
      },
      annotations: [
        Transaction.userEvent.of('input.complete'),
        BIB_VISUAL_TARGET.of({ mode: 'existing', entryId, local: true }),
      ],
    })
  }

  /**
   * Reparse visual edits locally and try incremental projection for undo/redo.
   * Arbitrary structural changes fall back to a full parse. All three paths
   * reconcile occurrence identities and emit the resulting state once.
   */
  update(update: ViewUpdate) {
    if (!update.docChanged) return

    this.revision++
    const oldEntries = this.entries
    // Save ids before recalculating duplicate-key occurrence indexes, since the
    // parsed entries can be reused across projections.
    const previousIdentities: PreviousBibEntryIdentity[] = oldEntries.map(entry => ({
      entryId: entry.entry.id,
      from: entry.from,
      to: entry.to,
    }))
    const visualTarget = update.transactions
      .map(transaction => transaction.annotation(BIB_VISUAL_TARGET))
      .find(target => target !== undefined)
    const visualUpdate = visualTarget
      ? this.applyVisualChange(update, oldEntries, visualTarget)
      : null
    const historyEvent = update.transactions.find(transaction =>
      transaction.isUserEvent('undo') || transaction.isUserEvent('redo')
    )

    if (visualUpdate) {
      this.entries = visualUpdate.entries
    } else {
      const incremental = historyEvent
        ? this.applyIncrementalChange(update, oldEntries)
        : null
      this.entries = incremental ?? this.parseEntries(this.view.state.doc.toString())
    }

    this.remapDiagnostics(update, oldEntries)
    updateOccurrenceIndexes(this.entries)
    if (visualUpdate) {
      const changedEntry = this.entries.find(
        entry => entry.from === visualUpdate.entryFrom
      )
      if (changedEntry) this.refreshEntryDiagnostics(changedEntry)
    }

    const identityChanges = getEntryIdentityChanges(
      update.changes,
      previousIdentities,
      this.entries
    )
    this.emitState(identityChanges.entryIdRemaps, identityChanges.removedEntryIds)
    this.emitHistoryState()

    if (!visualUpdate) {
      if (historyEvent) {
        this.emitHistoryApplied(update, historyEvent, previousIdentities, identityChanges)
      }
      this.scheduleFullValidation()
    }
  }

  destroy() {
    this.destroyed = true
    if (this.validationTimer !== null) clearTimeout(this.validationTimer)
    this.validationTimer = null
    if (this.dispatchHandler) {
      document.removeEventListener(BIB_WRITE_EVENT, this.dispatchHandler)
      document.removeEventListener(BIB_DELETE_EVENT, this.dispatchHandler)
      document.removeEventListener(BIB_IMPORT_EVENT, this.dispatchHandler)
      this.dispatchHandler = null
    }
    if (this.requestStateHandler) {
      document.removeEventListener(BIB_REQUEST_STATE_EVENT, this.requestStateHandler)
      this.requestStateHandler = null
    }
    if (this.scrollHandler) {
      document.removeEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
      this.scrollHandler = null
    }
    this.cancelScrollAlignment?.()
    this.cancelScrollAlignment = null
  }

  private emitHistoryState() {
    document.dispatchEvent(
      new CustomEvent(BIB_HISTORY_STATE_EVENT, {
        detail: {
          canUndo: undoDepth(this.view.state) > 0,
          canRedo: redoDepth(this.view.state) > 0,
          view: this.view,
        },
      })
    )
  }

  /** Emit the current parsed projection. Entry ids derive from citation keys and
   * their document-order occurrence indexes, so React receives explicit remaps
   * whenever an edit changes those ids.
   */
  private emitState(
    entryIdRemaps?: BibEntryIdRemap[],
    removedEntryIds?: string[]
  ) {
    const diagnosticByOccurrence = new Map<string, BibSourceDiagnostic[]>()
    const entryByStart = new Map(this.entries.map(entry => [entry.from, entry] as const))

    // Keep all diagnostics for each entry, including independent syntax errors.
    for (const diagnostic of this.diagnostics) {
      const exact = diagnostic.entryFrom === undefined
        ? undefined
        : entryByStart.get(diagnostic.entryFrom)
      const target = exact ?? nearestEntryAt(this.entries, diagnostic.from)
      if (!target) continue
      const messages = diagnosticByOccurrence.get(target.entry.id) ?? []
      messages.push(diagnostic)
      diagnosticByOccurrence.set(target.entry.id, messages)
    }

    // Preserve unchanged positioned-entry objects. This still refreshes the
    // exported array, but avoids allocating a new class instance for every entry
    // when a local field edit changes diagnostics on only one occurrence.
    this.entries = this.entries.map(entry => {
      const nextDiagnostics = diagnosticByOccurrence.get(entry.entry.id) ?? []
      const oldDiagnostics = getBibEntryDiagnostics(entry)
      if (
        oldDiagnostics.length === nextDiagnostics.length &&
        oldDiagnostics.every((old, index) => {
          const next = nextDiagnostics[index]
          return old.from === next.from && old.line === next.line &&
            old.code === next.code && old.field === next.field &&
            old.relatedFrom === next.relatedFrom
        })
      ) {
        return entry
      }
      const projected = this.makePositioned(
        entry.entry,
        entry.from,
        entry.to,
        nextDiagnostics,
        (entry as BibProjectedEntry).sourceFieldRanges
      ) as BibProjectedEntry
      return projected
    })

    document.dispatchEvent(
      new CustomEvent(BIB_ENTRIES_EVENT, {
        detail: {
          isBibFile: true,
          documentId: this.documentId,
          entries: this.entries,
          revision: this.revision,
          ...(entryIdRemaps !== undefined
            ? { entryIdRemaps, removedEntryIds: removedEntryIds ?? [] }
            : {}),
          view: this.view,
        },
      })
    )
  }

  /**
   * Preserve diagnostics for entries untouched by a transaction and map their
   * absolute coordinates through the same CodeMirror changes as entry ranges.
   * Diagnostics belonging to edited entries are recalculated separately or by
   * the debounced full-document validation.
   */
  private remapDiagnostics(update: ViewUpdate, previousEntries: PositionedBibtexEntry[]) {
    const changed: Array<{ from: number; to: number }> = []
    update.changes.iterChangedRanges((fromA, toA) => changed.push({ from: fromA, to: toA }))

    const previousEntryByStart = new Map(previousEntries.map(entry => [entry.from, entry] as const))
    this.diagnostics = this.diagnostics
      .filter(diagnostic => {
        const owner = diagnostic.entryFrom === undefined
          ? undefined
          : previousEntryByStart.get(diagnostic.entryFrom)
        if (owner) {
          return !changed.some(range =>
            range.from < owner.to && range.to > owner.from ||
            range.from === range.to && range.from > owner.from && range.from < owner.to
          )
        }
        return !changed.some(range => diagnostic.from >= range.from && diagnostic.from <= range.to)
      })
      .map(diagnostic => {
        const from = update.changes.mapPos(diagnostic.from, 1)
        const entryFrom = diagnostic.entryFrom === undefined
          ? undefined
          : update.changes.mapPos(diagnostic.entryFrom, 1)
        const relatedFrom = diagnostic.relatedFrom === undefined
          ? undefined
          : update.changes.mapPos(diagnostic.relatedFrom, 1)
        return this.withCurrentLine({ ...diagnostic, from, entryFrom, relatedFrom })
      })
      .sort((a, b) => a.from - b.from)
  }

  private withCurrentLine(diagnostic: BibSourceDiagnostic): BibSourceDiagnostic {
    const document = this.view.state.doc
    const lineAt = (from: number) =>
      document.lineAt(Math.max(0, Math.min(from, document.length))).number
    return {
      ...diagnostic,
      line: lineAt(diagnostic.from),
      relatedLine: diagnostic.relatedFrom === undefined
        ? undefined
        : lineAt(diagnostic.relatedFrom),
    }
  }

  /** Revalidate the changed entry only; ordinary visual keystrokes avoid a full-file scan. */
  private refreshEntryDiagnostics(entry: PositionedBibtexEntry) {
    const raw = this.view.state.sliceDoc(entry.from, entry.to)
    const diagnostics = validateBibSource(raw).map(diagnostic => {
      const from = entry.from + diagnostic.from
      return this.withCurrentLine({
        ...diagnostic,
        from,
        entryFrom: entry.from,
        relatedFrom: diagnostic.relatedFrom === undefined
          ? undefined
          : entry.from + diagnostic.relatedFrom,
      })
    })
    this.diagnostics.push(...diagnostics)
    this.diagnostics.sort((a, b) => a.from - b.from)
  }

  /** Code-mode edits can change structure anywhere; coalesce a full validation. */
  private scheduleFullValidation() {
    if (this.validationTimer !== null) clearTimeout(this.validationTimer)
    this.validationTimer = setTimeout(() => {
      this.validationTimer = null
      this.diagnostics = validateBibSource(this.view.state.doc.toString())
      this.emitState()
    }, 200)
  }

  private parseEntries(
    source: string,
    range?: { from: number; to: number },
    trustedWindow?: { from: number; to: number }
  ): PositionedBibtexEntry[] {
    try {
      const parsed = parseBibFile(source, range, trustedWindow)
      const doc = this.view.state.doc
      return parsed.map(entry =>
        Object.assign(entry, {
          line: doc.lineAt(entry.from).number,
          toLine: doc.lineAt(entry.to).number,
        })
      )
    } catch {
      // Malformed source may temporarily have no safe visual projection. The
      // original text remains untouched in CodeMirror and can still be edited
      // from the source editor.
      return []
    }
  }

  private makePositioned(
    entry: BibtexEntry,
    from: number,
    to: number,
    diagnostics: BibSourceDiagnostic[] = [],
    sourceFieldRanges?: BibProjectedEntry['sourceFieldRanges']
  ): PositionedBibtexEntry {
    const doc = this.view.state.doc
    const positioned = Object.assign(new PositionedBibtexEntry(), {
      entry,
      from,
      to,
      line: doc.lineAt(from).number,
      toLine: doc.lineAt(to).number,
    })
    if (sourceFieldRanges) {
      (positioned as BibProjectedEntry).sourceFieldRanges = sourceFieldRanges
    }
    setBibEntryDiagnostics(positioned, diagnostics)
    return positioned
  }

  /** Remap an unchanged entry through a CodeMirror document change. */
  private mapEntry(update: ViewUpdate, entry: PositionedBibtexEntry) {
    return this.makePositioned(
      entry.entry,
      update.changes.mapPos(entry.from, 1),
      update.changes.mapPos(entry.to, -1),
      getBibEntryDiagnostics(entry),
      (entry as BibProjectedEntry).sourceFieldRanges
    )
  }

  /** Reparse the visual edit's entry; fall back to a full parse if it is lost. */
  private applyVisualChange(
    update: ViewUpdate,
    oldEntries: PositionedBibtexEntry[],
    target: BibVisualTarget
  ): { entries: PositionedBibtexEntry[]; entryFrom: number } | null {
    const source = this.view.state.doc.toString()
    const previous = target.mode === 'existing'
      ? oldEntries.find(entry => entry.entry.id === target.entryId)
      : undefined
    if (target.mode === 'existing' && !previous) return null

    const sourceStart = previous
      ? update.changes.mapPos(previous.from, 1)
      : target.sourceStart
    if (sourceStart === undefined) return null

    let parsed: BibProjectedEntry | null = null
    if (previous && target.local) {
      // The field-write planner has already checked a single source entry.
      // Map its old end through the same transaction instead of reparsing the
      // entire bibliography to rediscover a boundary we already own.
      const end = update.changes.mapPos(previous.to, -1)
      if (end > sourceStart) {
        parsed = parseBibEntryInRange(source, sourceStart, end)
      }
    }
    // Whole-entry replacements and edits that change an entry's structure
    // must still rediscover boundaries from the full document.
    if (!parsed) parsed = parseBibEntryAt(source, sourceStart)
    if (!parsed) return null

    const entries = oldEntries.map(entry =>
      entry === previous
        ? this.makePositioned(parsed.entry, parsed.from, parsed.to, [], parsed.sourceFieldRanges)
        : this.mapEntry(update, entry)
    )
    if (target.mode === 'new') {
      entries.push(this.makePositioned(parsed.entry, parsed.from, parsed.to, [], parsed.sourceFieldRanges))
    }
    entries.sort((a, b) => a.from - b.from)
    return { entries, entryFrom: parsed.from }
  }

  /**
   * Update only entries touched by an undo/redo transaction. If a transaction
   * changes something that cannot be projected safely from the previous entry
   * ranges, return null and let the normal full parse handle it.
   */
  private applyIncrementalChange(
    update: ViewUpdate,
    oldEntries: PositionedBibtexEntry[]
  ): PositionedBibtexEntry[] | null {
    const changes: Array<{
      fromA: number
      toA: number
      fromB: number
      toB: number
    }> = []

    update.changes.iterChanges((fromA, toA, fromB, toB) => {
      changes.push({ fromA, toA, fromB, toB })
    })

    if (changes.length !== 1) return null

    const change = changes[0]
    const source = this.view.state.doc.toString()
    const next: PositionedBibtexEntry[] = []

    for (const entry of oldEntries) {
      const mappedFrom = update.changes.mapPos(entry.from, 1)
      const mappedTo = update.changes.mapPos(entry.to, -1)
      const affected = change.fromA <= entry.to && change.toA >= entry.from
      if (!affected) {
        // Entries before the edit retain both offsets and content. Reuse their
        // positioned model instead of allocating a wrapper on every undo/redo.
        next.push(
          mappedFrom === entry.from && mappedTo === entry.to
            ? entry
            : this.mapEntry(update, entry)
        )
        continue
      }

      if (mappedTo <= mappedFrom) continue

      const parsed = parseBibEntryAt(source, mappedFrom, mappedTo)
      if (!parsed) return null

      next.push(this.makePositioned(parsed.entry, parsed.from, parsed.to, [], parsed.sourceFieldRanges))
    }

    if (change.toB > change.fromB) {
      // Surviving, trusted entries delimit a self-contained local parse.
      // If a neighbor is malformed, use the full Lezer projection instead.
      const before = [...next].reverse().find(entry => entry.to <= change.fromB)
      const after = next.find(entry => entry.from >= change.toB)
      const trusted = (!before || (before as BibProjectedEntry).sourceFieldRanges) &&
        (!after || (after as BibProjectedEntry).sourceFieldRanges)
      const window = trusted ? {
        from: before?.to ?? 0,
        to: after?.from ?? source.length,
      } : undefined
      const inserted = this.parseEntries(source, {
        from: change.fromB,
        to: change.toB,
      }, window)
      const existingStarts = new Set(next.map(entry => entry.from))
      for (const entry of inserted) {
        if (
          existingStarts.has(entry.from) ||
          next.some(current => entry.from > current.from && entry.from < current.to)
        ) {
          continue
        }
        next.push(entry)
        existingStarts.add(entry.from)
      }
    }

    next.sort((a, b) => a.from - b.from)
    const doc = this.view.state.doc
    return next.map(entry => {
      const line = doc.lineAt(entry.from).number
      const toLine = doc.lineAt(entry.to).number
      if (entry.line === line && entry.toLine === toLine) return entry
      return this.makePositioned(
        entry.entry,
        entry.from,
        entry.to,
        getBibEntryDiagnostics(entry),
        (entry as BibProjectedEntry).sourceFieldRanges
      )
    })
  }

  private emitHistoryApplied(
    update: ViewUpdate,
    historyEvent: Transaction,
    oldEntries: PreviousBibEntryIdentity[],
    identityChanges: BibEntryIdentityChanges
  ) {
    const changedRanges: Array<{ from: number; to: number }> = []
    update.changes.iterChangedRanges((from, to) => {
      changedRanges.push({ from, to })
    })

    // Emit one reset for every existing entry touched by this history step.
    // A single undo transaction can change more than one range or entry.
    const kind = historyEvent.isUserEvent('undo') ? 'undo' : 'redo'
    const emitted = new Set<string>()
    for (const previous of oldEntries) {
      const wasChanged = changedRanges.some(({ from, to }) =>
        from === to
          ? from >= previous.from && from < previous.to
          : from < previous.to && to > previous.from
      )
      if (!wasChanged || emitted.has(previous.entryId)) continue

      const current = identityChanges.currentByPreviousId.get(previous.entryId)
      if (!current) continue

      emitted.add(previous.entryId)
      document.dispatchEvent(
        new CustomEvent(BIB_HISTORY_APPLIED_EVENT, {
          detail: {
            kind,
            // Key changes can remount the form before React sees this event.
            // Include both identities so listeners can invalidate the old draft.
            previousEntryId: previous.entryId,
            entryId: current.entry.id,
            entry: current.entry,
            view: this.view,
          },
        })
      )
    }
  }

  /**
   * Receive write/import/delete requests from React. Live field edits deliberately
   * do not carry an old document snapshot: rapid typing can produce another
   * transaction before React renders the previous one. Other writes and imports
   * honor the supplied snapshot guards so they cannot apply stale data.
   */
  private setupDispatchListener() {
    this.dispatchHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { view: EditorView; accepted?: boolean }
        | undefined
      if (!detail || detail.view !== this.view || this.view.state.readOnly) return

      const {
        entry,
        entries,
        mode,
        entryId,
        expectedEntry,
        expectedRevision,
        expectedDocument,
        historyUserEvent,
        fieldTarget,
      } = detail as {
        entry?: BibtexEntry
        entries?: BibtexEntry[]
        mode: 'existing' | 'new'
        entryId?: string
        expectedEntry?: BibtexEntry
        expectedRevision?: number
        expectedDocument?: unknown
        historyUserEvent?: BibHistoryUserEvent
        fieldTarget?: BibFieldWriteTarget
      }

      // Existing field writes target an entry id resolved against the current
      // CodeMirror projection. They intentionally tolerate a React
      // render lag while the user types. Revision/document guards are reserved
      // for structural operations that must not apply to a stale snapshot.
      const isLiveFieldWrite = ev.type === BIB_WRITE_EVENT &&
        mode === 'existing' && fieldTarget !== undefined &&
        entryId !== undefined
      if (
        !isLiveFieldWrite &&
        ev.type !== BIB_DELETE_EVENT &&
        ((typeof expectedRevision === 'number' &&
          expectedRevision !== this.revision) ||
          (expectedDocument !== undefined &&
            expectedDocument !== this.view.state.doc))
      ) {
        this.emitWriteFailed('doc-changed')
        ev.preventDefault()
        return
      }

      if (ev.type === BIB_WRITE_EVENT) {
        if (!entry) return

        const source = this.view.state.doc.toString()
        const current = entryId === undefined
          ? undefined
          : this.entries.find(candidate => candidate.entry.id === entryId)
        const isFieldWrite = mode === 'existing' && fieldTarget !== undefined &&
          entryId !== undefined
        if (isFieldWrite && (!current || (expectedEntry && current.entry !== expectedEntry))) {
          this.emitWriteFailed('entry-gone')
          ev.preventDefault()
          return
        }

        // Clearing a field that exists only in the form is a source no-op.
        if (
          isFieldWrite && current && fieldTarget.kind === 'field' &&
          !entry.hasField(fieldTarget.name) &&
          !current.entry.hasField(fieldTarget.name)
        ) {
          detail.accepted = true
          return
        }

        const offset = isFieldWrite && current ? current.from : 0
        const guard = isFieldWrite && current
          ? planBibFieldWrite(
              source.slice(current.from, current.to),
              entry,
              fieldTarget,
              fieldTarget.kind === 'field' && current.entry.hasField(fieldTarget.name)
            )
          : planBibWrite(source, entry, mode, current?.from)

        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          ev.preventDefault()
          return
        }

        this.view.dispatch({
          changes: {
            from: offset + guard.plan.from,
            to: offset + guard.plan.to,
            insert: guard.plan.insert,
          },
          annotations: [
            Transaction.userEvent.of(
              historyUserEvent ?? (mode === 'new' ? 'input.complete' : 'input.type')
            ),
            BIB_VISUAL_TARGET.of(mode === 'existing'
              ? { mode, entryId, local: isFieldWrite }
              : { mode, sourceStart: guard.plan.sourceStart ?? guard.plan.from }),
          ],
        })
        detail.accepted = true
      } else if (ev.type === BIB_IMPORT_EVENT) {
        const entriesArg = entries ?? []
        if (entriesArg.length === 0) return

        const source = this.view.state.doc.toString()
        const guard = planBibImport(source, entriesArg)
        if (guard.ok === false) {
          this.emitWriteFailed(guard.reason)
          ev.preventDefault()
          return
        }

        this.view.dispatch({
          changes: guard.changes,
          annotations: Transaction.userEvent.of('input.complete'),
        })
        detail.accepted = true
      } else if (ev.type === BIB_DELETE_EVENT) {
        const { entryIds } = detail as { entryIds?: string[] }
        const ids = entryIds ?? (entryId ? [entryId] : [])
        if (!entryIds && ids.length === 0) {
          this.emitWriteFailed('entry-gone')
          ev.preventDefault()
          return
        }

        const byId = new Map(this.entries.map(entry => [entry.entry.id, entry] as const))
        const starts = ids
          .map(id => byId.get(id)?.from)
          .filter((start): start is number => start !== undefined)
        if (starts.length !== ids.length) {
          this.emitWriteFailed('entry-gone')
          ev.preventDefault()
          return
        }

        const guard = planBibBulkDelete(
          this.view.state.doc.toString(),
          starts
        )
        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          return
        }
        if (guard.changes.length === 0) return

        this.view.dispatch({
          changes: guard.changes,
          annotations: Transaction.userEvent.of('delete'),
        })
      }
    }

    document.addEventListener(BIB_WRITE_EVENT, this.dispatchHandler)
    document.addEventListener(BIB_DELETE_EVENT, this.dispatchHandler)
    document.addEventListener(BIB_IMPORT_EVENT, this.dispatchHandler)

    this.requestStateHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { view?: EditorView }
        | undefined
      if (detail?.view !== this.view) return
      // Re-run structural diagnostics whenever the visual panel requests a
      // fresh projection. This covers returning from source mode even if its
      // debounced validation was cancelled by an editor/view lifecycle change.
      if (this.validationTimer !== null) clearTimeout(this.validationTimer)
      this.validationTimer = null
      this.diagnostics = validateBibSource(this.view.state.doc.toString())
      this.emitState()
      this.emitHistoryState()
    }
    document.addEventListener(BIB_REQUEST_STATE_EVENT, this.requestStateHandler)
  }

  private emitWriteFailed(reason: string) {
    document.dispatchEvent(
      new CustomEvent(BIB_WRITE_FAILED_EVENT, {
        detail: { reason, view: this.view },
      })
    )
  }

  private setupScrollListener() {
    this.scrollHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { view?: EditorView; position?: number; entryId?: string }
        | undefined
      if (!detail || detail.view !== this.view) return

      // A new request supersedes any pending alignment for this view.
      this.cancelScrollAlignment?.()
      this.cancelScrollAlignment = null

      const resolvePosition = () => {
        if (detail.entryId) {
          return this.entries.find(
            entry => entry.entry.id === detail.entryId
          )?.from
        }
        return typeof detail.position === 'number'
          ? detail.position
          : undefined
      }

      if (resolvePosition() === undefined) return

      // Do not issue the scroll effect until CodeMirror has a real layout. After
      // alignment, ResizeObserver keeps the target at the top while the revealed
      // editor is resizing, then releases the request once layout settles.
      let cancelled = false
      let frame = 0
      let scrollIssued = false
      let settledTimer: number | null = null
      const startedAt = performance.now()
      let observer: ResizeObserver | null = null

      const cleanup = () => {
        if (cancelled) return
        cancelled = true
        if (frame) cancelAnimationFrame(frame)
        if (settledTimer !== null) window.clearTimeout(settledTimer)
        observer?.disconnect()
        if (this.cancelScrollAlignment === cleanup) {
          this.cancelScrollAlignment = null
        }
      }
      this.cancelScrollAlignment = cleanup

      const releaseAfterLayoutSettles = () => {
        if (settledTimer !== null) window.clearTimeout(settledTimer)
        // A resize during this grace period cancels the timer and realigns again.
        settledTimer = window.setTimeout(cleanup, 250)
      }

      const scheduleAlignment = () => {
        if (cancelled || frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          if (cancelled) return
          if (resolvePosition() === undefined) {
            cleanup()
            return
          }
          if (!this.view.dom.isConnected) {
            // The source editor may be detached briefly while React changes modes.
            if (performance.now() - startedAt >= 2000) cleanup()
            else scheduleAlignment()
            return
          }

          const viewport = this.view.scrollDOM
          const editorRect = this.view.dom.getBoundingClientRect()
          if (viewport.clientHeight === 0 || editorRect.height === 0) {
            // Stay pending while the editor is hidden; ResizeObserver will also
            // wake this request as soon as the source editor becomes measurable.
            if (performance.now() - startedAt >= 2000) cleanup()
            else scheduleAlignment()
            return
          }

          const livePosition = resolvePosition()
          if (livePosition === undefined) {
            cleanup()
            return
          }
          const pos = Math.min(
            Math.max(0, livePosition),
            this.view.state.doc.length
          )

          if (!scrollIssued) {
            this.view.dispatch({
              selection: { anchor: pos },
              effects: EditorView.scrollIntoView(pos, {
                y: 'start',
                yMargin: 0,
              }),
            })
            this.view.focus()
            scrollIssued = true
          }

          // CodeMirror batches this DOM read and the exact scroll correction in
          // its own measure cycle, avoiding a race with its built-in scroll effect.
          this.view.requestMeasure({
            read: () => {
              const currentPosition = resolvePosition()
              if (currentPosition === undefined) return null
              const currentPos = Math.min(
                Math.max(0, currentPosition),
                this.view.state.doc.length
              )
              const coords = this.view.coordsAtPos(currentPos)
              const scrollRect = viewport.getBoundingClientRect()
              const currentEditorRect = this.view.dom.getBoundingClientRect()
              return {
                delta: coords ? coords.top - scrollRect.top : null,
                usable:
                  viewport.clientHeight > 0 && currentEditorRect.height > 0,
              }
            },
            write: measurement => {
              if (cancelled) return
              if (!measurement || !measurement.usable || measurement.delta === null) {
                scrollIssued = false
                if (performance.now() - startedAt >= 2000) cleanup()
                else scheduleAlignment()
                return
              }

              if (Math.abs(measurement.delta) > 1) {
                const before = viewport.scrollTop
                viewport.scrollTop = before + measurement.delta
                const after = viewport.scrollTop
                const maxScrollTop = viewport.scrollHeight - viewport.clientHeight
                const cannotScrollFurther =
                  after === before &&
                  ((measurement.delta < 0 && before <= 0) ||
                    (measurement.delta > 0 && before >= maxScrollTop - 1))

                // At the end of a document there may not be enough content below
                // the target to put it at the viewport top. Do not retry forever.
                if (cannotScrollFurther) {
                  releaseAfterLayoutSettles()
                  return
                }
              }

              releaseAfterLayoutSettles()
            },
          })
        })
      }

      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          if (settledTimer !== null) {
            window.clearTimeout(settledTimer)
            settledTimer = null
          }
          scheduleAlignment()
        })
        observer.observe(this.view.dom)
        observer.observe(this.view.scrollDOM)
      }
      scheduleAlignment()
    }
    document.addEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
  }
}

const bibEditorPlugin = ViewPlugin.fromClass(BibEditorPlugin)

export function commitBibKeyOnExit(view: EditorView, entryId: string, draft?: BibtexEntry): void {
  view.plugin(bibEditorPlugin)?.commitKeyOnExit(entryId, draft)
}

export const extension = (options?: {
  currentDoc?: { currentDoc?: { doc_id: string } }
}): Extension => [
  bibEditorPlugin,
  bibDocumentId.of(options?.currentDoc?.currentDoc?.doc_id ?? null),
]
