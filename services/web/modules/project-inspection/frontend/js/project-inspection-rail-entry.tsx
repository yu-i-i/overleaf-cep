import { FileMagnifyingGlass } from '@phosphor-icons/react'
import { t } from 'i18next'
import getMeta from '@/utils/meta'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import type { RailTabKey } from '@/features/ide-react/context/rail-context'
import ProjectInspectionPanel from './components/project-inspection-panel'

const { enableProjectInspection } = getMeta('ol-ExposedSettings') as {
  enableProjectInspection: bool
}

const ProjectInspectionIcon: RailElement['icon'] = ({ open, title }) => (
  <FileMagnifyingGlass
    aria-label={title}
    className="ide-rail-tab-link-icon"
    width={20}
    height={32}
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
  hide: !enableProjectInspection,
}

export default projectInspectionRailEntry
