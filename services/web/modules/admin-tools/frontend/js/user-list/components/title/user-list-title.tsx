import { useMemo } from 'react'
import classnames from 'classnames'
import { Filter, useUserListContext } from '../../context/user-list-context'

function UserListTitle({
  filter,
  className,
}: {
  filter: Filter
  className?: string
}) {
  const { filterTranslations } = useUserListContext()

  let message = filterTranslations.get(filter)
  let extraProps = {}

  return (
    <h1
      id="main-content"
      tabIndex={-1}
      className={classnames('user-list-title', className)}
      {...extraProps}
    >
      {message}
    </h1>
  )
}

export default UserListTitle
