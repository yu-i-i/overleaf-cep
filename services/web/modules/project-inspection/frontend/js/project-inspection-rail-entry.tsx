import { FileMagnifyingGlass } from '@phosphor-icons/react'
import { t } from 'i18next'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import type { RailTabKey } from '@/features/ide-react/context/rail-context'
import ProjectInspectionPanel from './components/project-inspection-panel'

const ProjectInspectionIcon: RailElement['icon'] = ({ open, title }) => (
  <FileMagnifyingGlass
    aria-label={title}
    className="ide-rail-tab-link-icon"
    size={20}
    weight={open ? 'fill' : 'regular'}
  />
)

const projectInspectionRailEntry: RailElement = {
  key: 'project-inspection' as RailTabKey,
  icon: ProjectInspectionIcon,
  get title() {
    return t('inspection_title')
  },
  component: <ProjectInspectionPanel />,
}

export default projectInspectionRailEntry
