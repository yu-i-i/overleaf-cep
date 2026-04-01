import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import FileTreeModalCreateFileMode from '@/features/file-tree/components/file-tree-create/file-tree-modal-create-file-mode'
import FileTreeCreateNameProvider from '@/features/file-tree/contexts/file-tree-create-name'
import FileTreeCreateNameInput from '@/features/file-tree/components/file-tree-create/file-tree-create-name-input'
import { useFileTreeCreateName } from '@/features/file-tree/contexts/file-tree-create-name'
import { useFileTreeCreateForm } from '@/features/file-tree/contexts/file-tree-create-form'
import ErrorMessage from '@/features/file-tree/components/file-tree-create/error-message'
import { FormEventHandler, useCallback, useEffect } from 'react'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'

function CreateDrawioFilePane() {
  const { newFileCreateMode, error, finishCreatingDoc, inFlight } =
    useFileTreeActionable()

  if (newFileCreateMode !== 'drawio') {
    return null
  }

  return (
    <FileTreeCreateNameProvider initialName="diagram.drawio">
      <CreateDrawioForm error={error} inFlight={inFlight} finishCreatingDoc={finishCreatingDoc} />
    </FileTreeCreateNameProvider>
  )
}

function CreateDrawioForm({
  error,
  inFlight,
  finishCreatingDoc,
}: {
  error: any
  inFlight: boolean
  finishCreatingDoc: (entity: { name: string }) => Promise<any>
}) {
  const { name, validName } = useFileTreeCreateName()
  const { setValid } = useFileTreeCreateForm()
  const { openDoc } = useEditorManagerContext()

  useEffect(() => {
    setValid(validName)
  }, [setValid, validName])

  const handleSubmit: FormEventHandler = useCallback(
    async event => {
      event.preventDefault()
      const doc = await finishCreatingDoc({ name })
      if (doc) {
        return await openDoc(doc)
      }
    },
    [finishCreatingDoc, name, openDoc]
  )

  return (
    <form noValidate id="create-file" onSubmit={handleSubmit}>
      <FileTreeCreateNameInput focusName error={error} inFlight={inFlight} />
      {error && <ErrorMessage error={error} />}
    </form>
  )
}

function DrawioCreateFileMode() {
  return (
    <FileTreeModalCreateFileMode
      mode="drawio"
      icon="schema"
      label="Draw.io Diagram"
    />
  )
}

export const CreateFilePane = CreateDrawioFilePane
export const CreateFileMode = DrawioCreateFileMode
export default CreateDrawioFilePane
