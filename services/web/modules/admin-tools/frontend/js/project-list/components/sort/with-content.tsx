import { useTranslation } from 'react-i18next'
import { Sort } from '../../../../../types/project/api'

type SortBtnOwnProps = {
  column: string
  sort: Sort
  appliedSort?: Sort | null
  showSortProgress?: boolean
  text: string
  onClick: () => void
}

type WithContentProps = {
  iconType?: string
  showSpinner?: boolean
  screenReaderText: string
}

export type SortBtnProps = SortBtnOwnProps & WithContentProps

function withContent<T extends SortBtnOwnProps>(
  WrappedComponent: React.ComponentType<T & WithContentProps>
) {
  function WithContent(hocProps: T) {
    const { t } = useTranslation()
    const { column, text, sort, appliedSort, showSortProgress } = hocProps
    const displayedSort = appliedSort ?? sort
    const showSpinner = !!showSortProgress && column === sort.by
    let iconType
    let screenReaderText = t('sort_by_x', { x: text })

    if (column === displayedSort.by) {
      if (!showSpinner) {
        iconType = displayedSort.order === 'asc'
          ? 'arrow_upward_alt'
          : 'arrow_downward_alt'
      }
      screenReaderText = t('reverse_x_sort_order', { x: text })
    }

    return (
      <WrappedComponent
        {...hocProps}
        iconType={iconType}
        showSpinner={showSpinner}
        screenReaderText={screenReaderText}
      />
    )
  }

  return WithContent
}

export default withContent
