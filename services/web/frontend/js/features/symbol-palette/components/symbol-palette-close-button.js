import { Button } from 'react-bootstrap'
import { useEditorContext } from '../../../shared/context/editor-context'

export default function SymbolPaletteCloseButton() {
  const { toggleSymbolPalette } = useEditorContext()

  return (
    <div className="symbol-palette-header-outer">
      <Button
        className="btn-close symbol-palette-close-button"
        onClick={toggleSymbolPalette} // Trigger closePanel on click
      >
      </Button>
    </div>
  )
}
