import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import useSelectedWordCountAction from './use-selected-word-count-action'

export default function SelectedWordCountAction() {
  const { isSelectionEmpty, handleClick, label } = useSelectedWordCountAction()

  if (isSelectionEmpty) {
    return null
  }

  return (
    <OLTooltip
      id="editor-floating-menu-selected-word-count"
      description={label}
      overlayProps={{ placement: 'right' }}
    >
      <button
        type="button"
        className="editor-floating-menu-button"
        onClick={handleClick}
        aria-label={label}
      >
        <MaterialIcon type="123" />
      </button>
    </OLTooltip>
  )
}
