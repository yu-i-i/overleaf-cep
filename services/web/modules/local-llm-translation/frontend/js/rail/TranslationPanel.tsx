import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { language } from '@codemirror/language'
import {
  CodeMirrorStateContext,
  CodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useProjectContext } from '@/shared/context/project-context'
import TranslationToolbar from '../TranslationToolbar'
import {
  getBridgedEditor,
  subscribeBridgedEditor,
  type BridgedEditor,
} from './editor-bridge'

export default function TranslationPanel() {
  const { projectId } = useProjectContext()
  // プロジェクトを移った際は、旧プロジェクトの訳・接続設定を引き継がない。
  return <ProjectTranslationPanel key={projectId} />
}

function ProjectTranslationPanel() {
  const editor = useSyncExternalStore(subscribeBridgedEditor, getBridgedEditor)
  const { currentDocumentId } = useEditorOpenDocContext()
  const manager = useEditorManagerContext()
  const permissions = usePermissionsContext()
  const lastEditor = useRef<BridgedEditor | null>(null)
  const available = Boolean(
    editor &&
    editor.docId === currentDocumentId &&
    currentDocumentId &&
    !manager.isLoading &&
    editor.state.facet(language)?.name === 'latex'
  )
  useLayoutEffect(() => {
    if (available) lastEditor.current = editor
  }, [available, editor])
  const retained = available ? editor : lastEditor.current

  if (!permissions.write)
    return <p className="p-3">翻訳にはプロジェクトの編集権限が必要です。</p>
  if (!retained)
    return (
      <p className="p-3">
        翻訳する .tex ファイルをエディターで開いてください。
      </p>
    )
  // 別ファイルへ移動しても訳済み部分は残す。ただし古いビューでの翻訳開始・保存は止める。
  return (
    <CodeMirrorViewContext.Provider value={retained.view}>
      <CodeMirrorStateContext.Provider value={retained.state}>
        {!available && (
          <p role="status" className="p-3">
            翻訳を開始・保存するには、対象の .tex
            ファイルを開いてください。訳済み部分のコピーは引き続き利用できます。
          </p>
        )}
        <TranslationToolbar embedded editorAvailable={available} />
      </CodeMirrorStateContext.Provider>
    </CodeMirrorViewContext.Provider>
  )
}
