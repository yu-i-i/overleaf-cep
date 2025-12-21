import { User } from '../../../../types/user/api'
import { updateUser, deleteUser, purgeUser, restoreUser } from './api'

export type AfterActions = {
  toggleSelectedUser?: (id: string, selected: boolean) => void
  updateUserViewData?: (user: User) => void
  removeUserFromView?: (user: User) => void
}

export function performDeleteUser(
  user: User,
  doAfter: AfterActions,
  options: { sendEmail: boolean },
) {

  return deleteUser(user.id, options.sendEmail).then(data => {
    doAfter.toggleSelectedUser(user.id, false)
    doAfter.updateUserViewData({
      ...user,
      ...data,
      deleted: true,
    })
  })
}

export function performUpdateUser(
  user: User,
  doAfter: AfterActions,
  options: { userData: Partial<user> },
) {

  const dataToUpdate = { ...options.userData}
  if (!user.allowUpdateDetails) {
    delete dataToUpdate.firstName
    delete dataToUpdate.lastName
  }
  if (!user.allowUpdateIsAdmin) {
    delete dataToUpdate.isAdmin
  }

  return updateUser(user.id, dataToUpdate).then(data => {
    doAfter.toggleSelectedUser(user.id, false)
    doAfter.updateUserViewData({
      ...user,
      ...data
    })
  })
}

export function performRestoreUser(
  user: User,
  doAfter: AfterActions,
) {

  return restoreUser(user.id).then(() => {
    doAfter.toggleSelectedUser(user.id, false)
    doAfter.updateUserViewData({
      ...user,
      deletedAt: undefined,
      deleted: false,
    })
  })
}

export function performPurgeUser(
  user: User,
  doAfter: AfterActions
) {
  return purgeUser(user.id).then(() => {
    doAfter.removeUserFromView(user)
  })
}
