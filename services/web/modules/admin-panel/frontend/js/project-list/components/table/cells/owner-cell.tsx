import { getUserName } from '../../../util/user'
import { Project } from '../../../../../../types/project/api'

type OwnerCellProps = {
  project: Project
}

export default function OwnerCell({ project }: OwnerCellProps) {
  const ownerName = getUserName(project.owner)

  return (
    <span translate="no">{ownerName}</span>
  )
}
