import { useEditorContext } from '../../../shared/context/editor-context'
import { useTranslation } from 'react-i18next'

export default function SymbolPaletteCloseButton() {
  const { toggleSymbolPalette } = useEditorContext()
  const { t } = useTranslation()

  return (
    <div className="symbol-palette-close-button-outer">
      <button
        type="button"
        className="btn-close symbol-palette-close-button"
        onClick={toggleSymbolPalette}
        aria-label={t('clear_search')}
      >
      </button>
    </div>
  )
}
