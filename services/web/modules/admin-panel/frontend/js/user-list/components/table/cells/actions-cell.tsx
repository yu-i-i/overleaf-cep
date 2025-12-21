import getMeta from '@/utils/meta'
import { DeleteUserButtonTooltip } from './action-buttons/delete-user-button'
import { RestoreUserButtonTooltip } from './action-buttons/restore-user-button'
import { PurgeUserButtonTooltip } from './action-buttons/purge-user-button'
import { FlagUserButtonTooltip } from './action-buttons/flag-user-button'
import { UpdateUserButtonTooltip } from './action-buttons/update-user-button'
import { User } from '../../../../../../types/user/api'

type ActionsCellProps = {
  user: User
}

export default function ActionsCell({ user }: ActionsCellProps) {
  const isSelf = getMeta('ol-user_id') === user.id
  return (
    <div className="d-flex justify-content-end">
      <div>
        <UpdateUserButtonTooltip user={user} />
      </div>
      <div style={isSelf ? { visibility: 'hidden' } : undefined }>
        <FlagUserButtonTooltip user={user} flag="suspended" />
        <DeleteUserButtonTooltip user={user} />
        <RestoreUserButtonTooltip user={user} />
        <PurgeUserButtonTooltip user={user} />
      </div>
    </div>
  )
}
