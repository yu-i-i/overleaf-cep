import { getUserName } from './user'
import { Project } from '../../../../types/project/api'

export function getOwnerName(project: Project) {
  if (project.owner != null) {
    return getUserName(project.owner)
  }
  return ''
}
