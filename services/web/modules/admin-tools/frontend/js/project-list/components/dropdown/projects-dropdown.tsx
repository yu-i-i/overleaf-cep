import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Filter,
  useProjectListContext,
} from '../../context/project-list-context'
import {
  OLDropdown,
  OLDropdownHeader,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import BackToUserList from '../back-to-user-list'
import ProjectsFilterMenu from '../projects-filter-menu'

type ItemProps = {
  filter: Filter
  text: string
  onClick?: () => void
}

export function Item({ filter, text, onClick }: ItemProps) {
  const { selectFilter } = useProjectListContext()
  const handleClick = () => {
    selectFilter(filter)
    onClick?.()
  }

  return (
    <ProjectsFilterMenu filter={filter}>
      {isActive => (
        <OLDropdownItem
          as="button"
          tabIndex={-1}
          onClick={handleClick}
          trailingIcon={isActive ? 'check' : undefined}
          active={isActive}
        >
          {text}
        </OLDropdownItem>
      )}
    </ProjectsFilterMenu>
  )
}

function ProjectsDropdown() {
  const { t } = useTranslation()
  const [title, setTitle] = useState(() => t('all_projects'))
  const { filter } = useProjectListContext()
  const filterTranslations = useRef<Record<Filter, string>>({
    owned: t('all_projects'),
    inactive: t('inactive_projects'),
    trashed: t('trashed_projects'),
    deleted: t('deleted_projects'),
  })

  useEffect(() => {
    setTitle(filterTranslations.current[filter])
  }, [filter, t])

  return (
    <OLDropdown>
      <OLDropdownToggle
        id="projects-types-dropdown-toggle-btn"
        className="ps-0 mb-0 btn-transparent h4"
        size="lg"
        aria-label={t('filter_projects')}
      >
        <span className="text-truncate" aria-hidden>
          {title}
        </span>
      </OLDropdownToggle>
      <OLDropdownMenu flip={false}>
        <li role="none">
          <Item filter="owned" text={t('all_projects')} />
        </li>
        <li role="none">
          <Item filter="inactive" text={t('inactive_projects')} />
        </li>
        <li role="none">
          <Item filter="trashed" text={t('trashed_projects')} />
        </li>
        <li role="none">
          <Item filter="deleted" text={t('deleted_projects')} />
        </li>
      </OLDropdownMenu>
    </OLDropdown>
  )
}

export default ProjectsDropdown
