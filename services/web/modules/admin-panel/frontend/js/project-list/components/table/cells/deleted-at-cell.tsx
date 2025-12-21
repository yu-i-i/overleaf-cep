import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { formatDate, fromNowDate } from '@/utils/dates'
import { Project } from '../../../../../../types/project/api'
import { DeletedBy } from './deleted-by'

type DeletedAtCellProps = {
  project: Project
}

export default function DeletedAtCell({ project }: DeletedAtCellProps) {
  const deletedAtDate = fromNowDate(project.deletedAt)
  const tooltipText = formatDate(project.deletedAt)

  return (
    <OLTooltip
      key={`tooltip-deleted-at-${project.id}`}
      id={`tooltip-deleted-at-${project.id}`}
      description={tooltipText}
      overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
    >
      {project.deletedBy ? (
        <span translate="no">
          <DeletedBy
            deletedBy={project.deletedBy}
            deletedAtDate={deletedAtDate}
          />
        </span>
      ) : (
        <span>{deletedAtDate}</span>
      )}
    </OLTooltip>
  )
}
