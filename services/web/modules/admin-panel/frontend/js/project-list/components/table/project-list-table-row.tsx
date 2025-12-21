import { memo } from 'react'
import OwnerCell from './cells/owner-cell'
import LastUpdatedCell from './cells/last-updated-cell'
import DeletedAtCell from './cells/deleted-at-cell'
import { Filter } from '../../context/project-list-context'
import ActionsCell from './cells/actions-cell'
import ActionsDropdown from '../dropdown/actions-dropdown'
import { getUserName } from '../../util/user'
import { Project } from '../../../../../types/project/api'
import { ProjectCheckbox } from './project-checkbox'

type ProjectListTableRowProps = {
  project: Project
  selected: boolean
  filter: Filter
}
function ProjectListTableRow({ project, selected, filter }: ProjectListTableRowProps) {
  return (
    <tr className={selected ? 'table-active' : undefined}>
      <td className="dash-cell-checkbox d-none d-md-table-cell">
        <ProjectCheckbox projectId={project.id} projectName={project.name} />
      </td>
      <td className="dash-cell-name" translate="no">
        {project.name}
      </td>
      {filter !== 'deleted' ? (
        <td className="dash-cell-date-owner pb-0 d-md-none">
          <LastUpdatedCell project={project} />
        </td>
      ) : (
        <td className="dash-cell-date-owner pb-0 d-md-none">
          <DeletedAtCell project={project} />
        </td>
      )}
      {filter !== 'deleted' ? (
        <td className="dash-cell-date d-none d-md-table-cell">
          <LastUpdatedCell project={project} />
        </td>
      ) : (
        <td className="dash-cell-date d-none d-md-table-cell">
          <DeletedAtCell project={project} />
        </td>
      )}
      <td className="dash-cell-actions">
        <div className="d-none d-md-block">
          <ActionsCell project={project} />
        </div>
        <div className="d-md-none">
          <ActionsDropdown project={project} />
        </div>
      </td>
    </tr>
  )
}
export default memo(ProjectListTableRow)
