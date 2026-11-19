import { useMemo, useState } from 'react'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { collectTexDocs } from '../split/tex-docs'

/** メインに文書を開いていないときも、公式レールから横並びのタブを開ける。 */
export default function SplitLauncherPanel() {
  const { fileTreeData } = useFileTreeData()
  const { currentDocumentId } = useEditorOpenDocContext()
  const docs = useMemo(() => collectTexDocs(fileTreeData), [fileTreeData])
  const [selectedId, setSelectedId] = useState('')
  const selected =
    docs.find(doc => doc.id === selectedId) ||
    docs.find(doc => doc.id === currentDocumentId) ||
    docs[0]
  return (
    <div className="p-3">
      <h2 style={{ fontSize: 20 }}>横並び表示</h2>
      <p>複数の .tex を右側のタブで開き、見比べながら編集できます。</p>
      <label className="w-100">
        文書
        <select
          aria-label="横並びに追加する文書"
          className="form-select"
          value={selected?.id || ''}
          disabled={!docs.length}
          onChange={event => setSelectedId(event.target.value)}
        >
          {!docs.length && <option value="">.tex ファイルがありません</option>}
          {docs.map(doc => (
            <option key={doc.id} value={doc.id}>
              {doc.path}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-primary mt-2"
        disabled={!selected}
        onClick={() => {
          if (selected)
            window.dispatchEvent(
              new CustomEvent('overleaf:open-bilingual-editor', {
                detail: { docId: selected.id },
              })
            )
        }}
      >
        横並びで開く
      </button>
    </div>
  )
}
