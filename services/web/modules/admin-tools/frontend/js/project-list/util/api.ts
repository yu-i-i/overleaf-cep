import {
  GetProjectsResponseBody,
  GetProjectsRequestBody,
} from '../../../../types/project/api'
import { deleteJSON, postJSON } from '@/infrastructure/fetch-json'

export type TransferOwnershipOptions = {
  user_id: string
  skipEmails: boolean
}

export function getProjects({
  userId,
  ...body
}: GetProjectsRequestBody & {
  userId: string | null
}): Promise<GetProjectsResponseBody> {
  const url = userId ? `/admin/user/${userId}/projects` : '/admin/projects'
  return postJSON(url, { body })
}

export function deleteProject(projectId: string) {
  return deleteJSON(`/admin/project/${projectId}`)
}

export function purgeProject(projectId: string) {
  return deleteJSON(`/admin/project/${projectId}/purge`)
}

export function undeleteProject(projectId: string, userId: string) {
  return postJSON(`/admin/project/${projectId}/undelete`, { body: { userId } })
}

export function trashProjectForUser(projectId: string, userId: string) {
  return postJSON(`/admin/project/${projectId}/trash`, { body: { userId } })
}

export function untrashProjectForUser(projectId: string, userId: string) {
  return postJSON(`/admin/project/${projectId}/untrash`, { body: { userId } })
}
export function transferProjectOwnership(
  projectId: string,
  options: TransferOwnershipOptions
) {
  return postJSON(`/project/${projectId}/transfer-ownership`, {
    body: { ...options },
  })
}
