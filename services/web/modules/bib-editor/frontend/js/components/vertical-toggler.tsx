import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'

type VerticalTogglerProps = {
  id: string
  onClick: () => void
  tooltip: string
}

export function VerticalToggler({
  id,
  onClick,
  tooltip,
}: VerticalTogglerProps) {
  return (
    <OLTooltip
      id={id}
      description={tooltip}
      overlayProps={{ placement: 'top' }}
    >
      <button
        type="button"
        className="custom-toggler custom-toggler-vertical"
        aria-label={tooltip}
        title=""
        onClick={onClick}
      >
        <MaterialIcon type="keyboard_arrow_up" />
      </button>
    </OLTooltip>
  )
}
