import { useLayoutEffect } from 'react'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { clearEditor, publishEditor } from './editor-bridge'

/** 公式のツールバースロットから、メインエディターだけをレールへ中継する。 */
export default function CodeMirrorBridge() {
  const state = useCodeMirrorStateContext()
  const view = useCodeMirrorViewContext()
  const { currentDocumentId, currentDocument } = useEditorOpenDocContext()
  useLayoutEffect(() => {
    // 同じツールバーを別パネルでも使う場合、そちらのビューを公開しない。
    if (
      currentDocument?.doc_id === currentDocumentId &&
      currentDocument?.cm6?.view === view
    ) {
      publishEditor({ state, view, docId: currentDocumentId })
    } else {
      clearEditor(view)
    }
  }, [state, view, currentDocumentId, currentDocument])
  // 文書や選択範囲の変更では解除しない。ビューが外れたときだけ参照を消す。
  useLayoutEffect(() => () => clearEditor(view), [view])
  return null
}
