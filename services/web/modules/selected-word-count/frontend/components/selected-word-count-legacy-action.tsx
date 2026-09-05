import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import useSelectedWordCountAction from './use-selected-word-count-action'

export default function SelectedWordCountLegacyAction() {
  const { isSelectionEmpty, handleClick, label } = useSelectedWordCountAction()

  if (isSelectionEmpty) {
    return null
  }

  return (
    <>
      <div className="review-tooltip-menu-divider" />
      <OLTooltip
        id="review-tooltip-menu-selected-word-count"
        description={label}
      >
        <button
          type="button"
          className="review-tooltip-menu-button"
          onClick={handleClick}
          aria-label={label}
        >
          <MaterialIcon type="123" />
        </button>
      </OLTooltip>
    </>
  )
}
