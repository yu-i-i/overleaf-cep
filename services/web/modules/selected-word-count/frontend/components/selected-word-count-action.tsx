import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import useSelectedWordCountAction from '../js/hooks/use-selected-word-count-action'

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
        className="editor-floating-menu-button justify-content-start gap-1 text-nowrap"
        onClick={handleClick}
        aria-label={label}
      >
        <MaterialIcon type="123" />
        <span>{label}</span>
      </button>
    </OLTooltip>
  )
}
