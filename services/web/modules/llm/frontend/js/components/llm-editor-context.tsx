import { useContext, useEffect } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { FileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'

export default function LLMEditorContext() {
  const view = useCodeMirrorViewContext()
  const { currentDocumentId, currentDocument } = useEditorOpenDocContext()
  const paths = useContext(FileTreePathContext)
  const path =
    currentDocumentId && paths?.pathInFolder(String(currentDocumentId))
  useEffect(() => {
    // 横並びエディターやファイル切替中の古いビューを参照しないよう、現在の
    // メイン文書と照合します。本文は送信時だけ取得し、グローバル変数に保持しません。
    if (
      !view ||
      !path ||
      currentDocument?.doc_id !== currentDocumentId ||
      currentDocument?.cm6?.view !== view
    )
      return
    const snapshot = (event: Event) => {
      const doc = view.state.doc
      const selection = view.state.selection.main
      const from = Math.max(0, selection.from - 6000)
      const to = Math.min(doc.length, from + 20000)
      ;(event as CustomEvent).detail.snapshot = {
        file: path,
        text: doc.sliceString(from, to),
        from,
        selection: doc.sliceString(
          selection.from,
          Math.min(selection.to, selection.from + 8000)
        ),
        truncated: from > 0 || to < doc.length,
      }
    }
    window.addEventListener('llm-chat-snapshot', snapshot)
    return () => window.removeEventListener('llm-chat-snapshot', snapshot)
  }, [view, path, currentDocument, currentDocumentId])
  return null
}
