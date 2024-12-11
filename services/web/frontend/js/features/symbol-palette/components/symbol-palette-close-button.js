import { Button } from 'react-bootstrap'
import { useEditorContext } from '../../../shared/context/editor-context'

export default function SymbolPaletteCloseButton() {
  const { toggleSymbolPalette } = useEditorContext()

  return (
      <Button
        bsStyle="link"
        bsSize="small"
        className="symbol-palette-close-button"
        onClick={toggleSymbolPalette} // Trigger closePanel on click
      >
        &times;
      </Button>
  )
}

