import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import classnames from 'classnames'
import * as eventTracking from '@/infrastructure/event-tracking'
import { isSmallDevice } from '@/infrastructure/event-tracking'
import OLCol from '@/shared/components/ol/ol-col'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import MaterialIcon from '@/shared/components/material-icon'
import { MergeAndOverride } from '../../../../../../types/utils'

type SearchFormOwnProps = {
  inputValue: string
  setInputValue: (input: string) => void
}

type SearchFormProps = MergeAndOverride<
  React.ComponentProps<typeof OLForm>,
  SearchFormOwnProps
>

function SearchForm({
  inputValue,
  setInputValue,
  className,
  ...props
}: SearchFormProps) {
  const { t } = useTranslation()
  const placeholder = t('search')+'…'

  const [localValue, setLocalValue] = useState(inputValue)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLocalValue(inputValue)
  }, [inputValue])

  const handleChange: React.ComponentProps<
    typeof OLFormControl
  >['onChange'] = e => {
    eventTracking.sendMB('admin-user-list-page-interaction', {
      action: 'search',
      isSmallDevice,
    })

    const value = e.target.value
    setLocalValue(value)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      setInputValue(value)
    }, 300)
  }

  const handleClear = () => {
    setLocalValue('')
    setInputValue('')
  }

  return (
    <OLForm
      className={classnames('user-search', className)}
      role="search"
      onSubmit={e => e.preventDefault()}
      {...props}
    >
      <OLFormGroup>
        <OLCol>
          <OLFormControl
            name="search"
            type="text"
            value={localValue}
            onChange={handleChange}
            placeholder={placeholder}
            aria-label={placeholder}
            prepend={<MaterialIcon type="search" />}
            append={
              localValue.length > 0 && (
                <button
                  type="button"
                  className="form-control-search-clear-btn"
                  aria-label={t('clear_search')}
                  onClick={handleClear}
                >
                  <MaterialIcon type="clear" />
                </button>
              )
            }
          />
        </OLCol>
      </OLFormGroup>
    </OLForm>
  )
}

export default SearchForm
