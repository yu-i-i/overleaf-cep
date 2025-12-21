import { GetUsersResponseBody, Sort } from '../../../../types/user/api'
import { deleteJSON, postJSON } from '@/infrastructure/fetch-json'

export function getUsers(sortBy: Sort): Promise<GetUsersResponseBody> {
  return postJSON('/api/user', { body: { sort: sortBy } })
}

export function updateUser(userId: string, userData: Partial<User>) {
  return postJSON(`/admin/user/${userId}/update`, { body: userData })
}

export function deleteUser(userId: string, sendEmail: boolean) {
  return postJSON(`/admin/user/${userId}/delete`, { body: { skipEmail: !sendEmail } })
}

export function restoreUser(userId: string) {
  return postJSON(`/admin/user/${userId}/restore`)
}

export function purgeUser(userId: string) {
  return deleteJSON(`/admin/user/${userId}`)
}
