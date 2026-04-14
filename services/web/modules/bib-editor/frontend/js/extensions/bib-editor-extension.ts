/**
 * CodeMirror extension for the bib-editor module.
 * Detects when a .bib file is open:
 *   1. Parses BibTeX entries from the document
 *   2. Posts them to a global event bus so the React sidebar can read them
 *   3. Listens for dispatch requests from the sidebar
 *
 * Registered via overleafModuleImports.sourceEditorExtensions in settings.
 */
import { Extension, StateField, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { parseBibFile, ParsedBibEntry } from '../utils/bib-parser'

/**
 * Custom event types for communication between CodeMirror and React.
 */
const BIB_ENTRIES_EVENT = 'bib-editor:entries-updated'
const BIB_DISPATCH_EVENT = 'bib-editor:dispatch'
const BIB_DOC_CHANGE_EVENT = 'bib-editor:doc-changed'

/**
 * StateField to track whether the current document is a .bib file.
 * Updated by the ViewPlugin when the document name changes.
 */
const isBibFileField = StateField.define<boolean>({
  create() {
    return false
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBibFileEffect)) {
        return effect.value
      }
    }
    return value
  },
})

const setBibFileEffect = StateEffect.define<boolean>()

/**
 * ViewPlugin that watches for document changes and parses BibTeX entries.
 */
const bibEditorPlugin = ViewPlugin.fromClass(
  class {
    private isBibFile = false
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    private dispatchHandler: ((ev: Event) => void) | null = null

    constructor(private view: EditorView) {
      this.checkAndParse()
      this.setupDispatchListener()
    }

    update(update: ViewUpdate) {
      // Re-check on document changes
      if (update.docChanged) {
        this.debouncedParse()
      }
    }

    destroy() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      if (this.dispatchHandler) {
        document.removeEventListener(BIB_DISPATCH_EVENT, this.dispatchHandler)
      }
    }

    private checkAndParse() {
      this.isBibFile = this.detectBibFile()
      if (this.isBibFile) {
        this.parseAndEmit()
      }
      // Always emit doc change event so the sidebar knows the file type
      this.emitDocChange()
    }

    private debouncedParse() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.isBibFile = this.detectBibFile()
        if (this.isBibFile) {
          this.parseAndEmit()
        }
        this.emitDocChange()
      }, 300)
    }

    private detectBibFile(): boolean {
      // Check the document name from the docName StateField
      try {
        // The docName extension stores the filename in a StateField
        // We check if the state has a field whose value ends with .bib
        const state = this.view.state
        for (const field of Object.keys(state)) {
          // We can't directly access docName field, so use a heuristic:
          // check the document content for BibTeX patterns
        }
      } catch {
        // fall back to content-based detection
      }

      // Content-based detection: check if document starts with @ entries
      const doc = this.view.state.doc
      const firstLine = doc.lineAt(0).text.trim()
      if (firstLine.startsWith('%') || firstLine.startsWith('@')) {
        // Check for at least one @type{
        const sample = doc.sliceString(0, Math.min(doc.length, 2000))
        return /@\s*[\w-]+\s*\{/i.test(sample)
      }

      return false
    }

    private parseAndEmit() {
      const source = this.view.state.doc.toString()
      try {
        const entries = parseBibFile(source)
        document.dispatchEvent(
          new CustomEvent(BIB_ENTRIES_EVENT, {
            detail: { entries, source, isBibFile: true },
          })
        )
      } catch {
        // parsing failed, emit empty
        document.dispatchEvent(
          new CustomEvent(BIB_ENTRIES_EVENT, {
            detail: { entries: [], source, isBibFile: true },
          })
        )
      }
    }

    private emitDocChange() {
      const source = this.view.state.doc.toString()
      document.dispatchEvent(
        new CustomEvent(BIB_DOC_CHANGE_EVENT, {
          detail: { isBibFile: this.isBibFile, source },
        })
      )
    }

    /**
     * Listen for dispatch requests from the React sidebar.
     * The sidebar sends {from, to, insert} objects.
     */
    private setupDispatchListener() {
      this.dispatchHandler = (ev: Event) => {
        const detail = (ev as CustomEvent).detail
        if (!detail) return
        const { from, to, insert } = detail
        if (typeof from !== 'number' || typeof to !== 'number') return
        this.view.dispatch({
          changes: { from, to, insert: insert ?? '' },
        })
      }
      document.addEventListener(BIB_DISPATCH_EVENT, this.dispatchHandler)
    }
  }
)

/**
 * The extension to export for the sourceEditorExtensions module hook.
 */
export const extension = (): Extension => {
  return [bibEditorPlugin]
}

/**
 * Event constants exported for use by the React context.
 */
export { BIB_ENTRIES_EVENT, BIB_DISPATCH_EVENT, BIB_DOC_CHANGE_EVENT }
