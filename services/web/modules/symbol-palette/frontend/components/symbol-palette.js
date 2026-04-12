import SymbolPaletteContent from './symbol-palette-content'
import { SymbolPaletteConfigProvider } from '../context/symbol-palette-context'

export default function SymbolPalette() {
  const handleSelect = (symbol) => {
    window.dispatchEvent(new CustomEvent('editor:insert-symbol', { detail: symbol }))
  }
  return (
    <SymbolPaletteConfigProvider>
      <SymbolPaletteContent handleSelect={handleSelect} />
    </SymbolPaletteConfigProvider>
  )
}
