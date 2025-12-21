import {
  GetProjectsResponseBody,
  Sort,
} from '../../../../types/project/api'
import { deleteJSON, postJSON } from '@/infrastructure/fetch-json'

export type TransferOwnershipOptions = {
  user_id: string
  skipEmails: boolean
}

export function getProjects( 
  params: { 
    userId: string, 
    by: Sort['by']
    order: Sort['order']
  }): Promise<GetProjectsResponseBody> {
  const { userId, ...sort } = params
  return postJSON(`/admin/user/${userId}/projects`, { body: { sort } })
}

export function archiveProject(projectId: string) {
  return postJSON(`/project/${projectId}/archive`)
}

export function deleteProject(projectId: string) {
  return deleteJSON(`/project/${projectId}`)
}

export function purgeProject(projectId: string) {
  return deleteJSON(`/project/${projectId}/purge`)
}

export function undeleteProject(projectId: string, userId: string) {
  return postJSON(`/project/${projectId}/undelete`, { body: { userId } })
}

export function trashProjectForUser(projectId: string, userId: string) {
  return postJSON(`/project/${projectId}/user/${userId}/trash`)
}

export function untrashProjectForUser(projectId: string, userId: string) {
  return deleteJSON(`/project/${projectId}/user/${userId}/trash`)
}
export function transferProjectOwnership(projectId: string, options: TransferOwnershipOptions) {
  return postJSON(`/project/${projectId}/transfer-ownership`, { body: { ...options } })
}
