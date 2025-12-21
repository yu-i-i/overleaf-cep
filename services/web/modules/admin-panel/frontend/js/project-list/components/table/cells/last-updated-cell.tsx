import { formatDate, fromNowDate } from '@/utils/dates'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { Project } from '../../../../../../types/project/api'
import { LastUpdatedBy } from './last-updated-by'

type LastUpdatedCellProps = {
  project: Project
}

export default function LastUpdatedCell({ project }: LastUpdatedCellProps) {
  const lastUpdatedDate = fromNowDate(project.lastUpdated)

  const tooltipText = formatDate(project.lastUpdated)
  return (
    <OLTooltip
      key={`tooltip-last-updated-${project.id}`}
      id={`tooltip-last-updated-${project.id}`}
      description={tooltipText}
      overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
    >
      {project.lastUpdatedBy ? (
        <span translate="no">
          <LastUpdatedBy
            lastUpdatedBy={project.lastUpdatedBy}
            lastUpdatedDate={lastUpdatedDate}
          />
        </span>
      ) : (
        <span>{lastUpdatedDate}</span>
      )}
    </OLTooltip>
  )
}
