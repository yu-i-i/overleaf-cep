import { EditorLoadingPane } from '@/features/ide-react/components/editor/editor-loading-pane'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreeOpenContext } from '@/features/ide-react/context/file-tree-open-context'
import classNames from 'classnames'
import SourceEditor from '@/features/source-editor/components/source-editor'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { PythonEditorSplit } from '@/features/ide-react/components/layout/python-editor-split'
import { isInExperiment } from '@/utils/labs-utils'

export const Editor = () => {
  const { opening, errorState } =
    useEditorPropertiesContext()
  const { selectedEntityCount, openEntity } = useFileTreeOpenContext()
  const { currentDocumentId, currentDocument } = useEditorOpenDocContext()
  const isPythonDocument =
    openEntity?.type === 'doc' &&
    openEntity.entity.name.toLowerCase().endsWith('.py')
  const pythonExecutionEnabled = isInExperiment('overleaf-code')

  if (!currentDocumentId) {
    return null
  }

  const isLoading = Boolean(
    (!currentDocument || opening) && !errorState && currentDocumentId
  )

  return (
    <div
      className={classNames('ide-redesign-editor-content', {
        hidden: openEntity?.type !== 'doc' || selectedEntityCount !== 1,
      })}
    >
      <div className="ide-redesign-editor-panel" style={{ height: '100%' }}>
        {isPythonDocument && pythonExecutionEnabled ? (
          <PythonEditorSplit />
        ) : (
          <SourceEditor />
        )}
        {isLoading && <EditorLoadingPane />}
      </div>
    </div>
  )
}
