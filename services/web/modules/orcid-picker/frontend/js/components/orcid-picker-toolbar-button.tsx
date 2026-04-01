import { useState, useCallback } from 'react'
import {
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { EditorSelection } from '@codemirror/state'
import OrcidPickerModal from './orcid-picker-modal'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

export default function OrcidPickerToolbarButton() {
  const view = useCodeMirrorViewContext()
  const { openDocName } = useEditorOpenDocContext()
  const [showModal, setShowModal] = useState(false)

  const isBibFile = openDocName != null && openDocName.endsWith('.bib')

  const handleInsert = useCallback(
    (bibtex: string) => {
      if (!view) return
      const doc = view.state.doc
      const end = doc.length
      const prefix =
        end > 0 && doc.sliceString(end - 1) !== '\n' ? '\n\n' : end > 0 ? '\n' : ''
      const insert = prefix + bibtex + '\n'
      view.dispatch({
        changes: { from: end, insert },
        selection: EditorSelection.cursor(end + insert.length),
        scrollIntoView: true,
      })
      view.focus()
    },
    [view]
  )

  if (!isBibFile) {
    return null
  }

  return (
    <>
      <div className="ol-cm-toolbar-button-group" data-overflow="group-orcid">
        <OLTooltip
          id="toolbar-orcid-picker"
          description="Import from ORCID"
          overlayProps={{ placement: 'bottom' }}
        >
          <button
            className="ol-cm-toolbar-button"
            aria-label="Import from ORCID"
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setShowModal(true)}
          >
            <MaterialIcon
              type="person_search"
              accessibilityLabel="Import from ORCID"
            />
          </button>
        </OLTooltip>
      </div>
      <OrcidPickerModal
        show={showModal}
        handleHide={() => setShowModal(false)}
        onInsert={handleInsert}
      />
    </>
  )
}
