import { ViewPlugin } from '@codemirror/view'
import type { DocumentContainer } from '@/features/ide-react/editor/document-container'
import type { EditorFacade, ChangeDescription } from '@/features/source-editor/extensions/realtime'
import getMeta from '@/utils/meta'
import { notifyFileOpened, notifyLocalEdit, notifyFileSaved } from './wakatime-tracker'

/**
 * Registered via overleafModuleImports.sourceEditorExtensions.
 *
 * Sends WakaTime heartbeats for genuinely local editor activity, without
 * touching the CodeMirror/ShareJS realtime plumbing directly. It relies on
 * the `origin` already computed by the realtime extension's `chooseOrigin`:
 * `origin === undefined` on a docChanged transaction means a real local
 * keystroke, as opposed to `'remote'` (a collaborator's edit applied via
 * OT), `'undo'` or `'reject'`.
 */
export const extension = (options: Record<string, any>) => {
  if (!getMeta('ol-ExposedSettings')?.wakaTimeEnabled) return []

  const currentDoc = options.currentDoc?.currentDoc as
    | DocumentContainer
    | undefined
  const docName = options.docName as string
  const projectId = getMeta('ol-project_id') as string

  if (!currentDoc || !docName || !projectId) return []

  notifyFileOpened(projectId, docName)

  const handleChange = (_editor: EditorFacade, change: ChangeDescription) => {
    if (change.origin === undefined) {
      notifyLocalEdit(projectId, docName)
    }
  }

  let recentlyEditedLocally = false
  const markLocalEdit = (_editor: EditorFacade, change: ChangeDescription) => {
    if (change.origin === undefined) {
      recentlyEditedLocally = true
    }
  }

  // document-container.ts dispatches this window event (not a `trigger` on
  // `currentDoc` itself) whenever the ShareJS doc for *any* open file has
  // drained its pending ops — filter to our own doc_id.
  const handleSaved = (event: Event) => {
    const { id } = (event as CustomEvent<{ id: string }>).detail || {}
    if (id === currentDoc.doc_id && recentlyEditedLocally) {
      notifyFileSaved(projectId, docName)
      recentlyEditedLocally = false
    }
  }

  const attach = () => {
    currentDoc.cm6?.on('change', handleChange)
    currentDoc.cm6?.on('change', markLocalEdit)
  }

  if (currentDoc.cm6) {
    attach()
  } else {
    currentDoc.on('cm6:attach', attach)
  }

  window.addEventListener('doc:saved', handleSaved)

  return ViewPlugin.define(() => ({
    destroy() {
      currentDoc.off('cm6:attach', attach)
      window.removeEventListener('doc:saved', handleSaved)
      currentDoc.cm6?.off('change', handleChange)
      currentDoc.cm6?.off('change', markLocalEdit)
    },
  }))
}
