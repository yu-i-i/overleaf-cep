import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export type BridgedEditor = {
  state: EditorState
  view: EditorView
  docId: string | null
}
let current: BridgedEditor | null = null
const listeners = new Set<() => void>()
export const getBridgedEditor = () => current
export function subscribeBridgedEditor(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React の描画中には公開しない。同じ状態での通知を省き、購読のループを防ぐ。 */
export function publishEditor(editor: BridgedEditor) {
  if (
    current?.state === editor.state &&
    current.view === editor.view &&
    current.docId === editor.docId
  )
    return
  current = editor
  listeners.forEach((listener) => listener())
}

/** 古いエディターの後片付けで、新しいエディターの参照を消さない。 */
export function clearEditor(view: EditorView) {
  if (current?.view !== view) return
  current = null
  listeners.forEach((listener) => listener())
}
