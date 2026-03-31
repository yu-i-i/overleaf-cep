import { useState, useCallback } from 'react'
import {
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { EditorSelection } from '@codemirror/state'
import DoiPickerModal from './doi-picker-modal'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

export default function DoiPickerToolbarButton() {
  const view = useCodeMirrorViewContext()
  const { openDocName } = useEditorOpenDocContext()
  const [showModal, setShowModal] = useState(false)

  const isBibFile = openDocName != null && openDocName.endsWith('.bib')

  const handleInsert = useCallback(
    (bibtex: string) => {
      if (!view) return
      const doc = view.state.doc
      const end = doc.length
      // Add a blank line separator before the new entry if the doc is non-empty
      const prefix = end > 0 && doc.sliceString(end - 1) !== '\n' ? '\n\n' : end > 0 ? '\n' : ''
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
      <div className="ol-cm-toolbar-button-group" data-overflow="group-doi">
        <OLTooltip
          id="toolbar-doi-picker"
          description="Import from DOI"
          overlayProps={{ placement: 'bottom' }}
        >
          <button
            className="ol-cm-toolbar-button"
            aria-label="Import from DOI"
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setShowModal(true)}
          >
            <MaterialIcon type="link" accessibilityLabel="Import from DOI" />
          </button>
        </OLTooltip>
      </div>
      <DoiPickerModal
        show={showModal}
        handleHide={() => setShowModal(false)}
        onInsert={handleInsert}
      />
    </>
  )
}
