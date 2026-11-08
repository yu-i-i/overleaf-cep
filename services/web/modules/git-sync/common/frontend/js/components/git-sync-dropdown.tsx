import {
  OLDropdown,
  OLDropdownToggle,
  OLDropdownMenu,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'
import MaterialIcon from '@/shared/components/material-icon'

type GitSyncDropdownProps = {
  id: string
  value: string
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
}

export default function GitSyncDropdown({
  id,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: GitSyncDropdownProps) {
  const selected = options.find(option => option.value === value)

  return (
    <OLDropdown className="git-sync-dropdown w-100">
      <div className="form-control-wrapper w-100">
        <OLDropdownToggle
          id={id}
          disabled={disabled}
          variant="secondary"
          className="git-sync-dropdown-toggle select-trigger form-control d-flex form-control-offset-end no-default-caret"
        >
          <span className="d-block text-truncate">{selected?.label || placeholder}</span>
        </OLDropdownToggle>
        <span className="form-control-end-icon">
          <MaterialIcon type="keyboard_arrow_down" />
        </span>
      </div>
      <OLDropdownMenu className="overflow-auto">
        {options.map(option => (
          <OLDropdownItem
            as="button"
            key={option.value}
            active={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </OLDropdownItem>
        ))}
      </OLDropdownMenu>
    </OLDropdown>
  )
}
