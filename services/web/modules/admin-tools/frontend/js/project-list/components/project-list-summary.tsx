import { useTranslation } from 'react-i18next'
import {
  OLDropdown,
  OLDropdownMenu,
  OLDropdownItem,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import { useProjectListContext } from '../context/project-list-context'

const OPTIONS = [20, 40, 80]

export default function ProjectListSummary() {
  const {
    visibleProjects,
    hiddenProjectsCount,
    projectsPerPage,
    setProjectsPerPage,
  } = useProjectListContext()

  const { t } = useTranslation()

  return (
    <div className="text-center">
        <span aria-live="polite">
          {t('showing_x_out_of_n_projects', {
            x: visibleProjects.length,
            n: visibleProjects.length + hiddenProjectsCount,
          })}
        </span>

        <span className="mx-2">·</span>

        <span className="d-inline-flex gap-1">
          <OLDropdown>

            <OLDropdownToggle
              as="span"
              className="entries-per-page-toggle"
            >
              {projectsPerPage}
            </OLDropdownToggle>

            <OLDropdownMenu>
              {OPTIONS.map((value) => (
                <OLDropdownItem
                  key={value}
                  active={value === projectsPerPage}
                  onClick={() => setProjectsPerPage(value)}
                >
                  {value}
                </OLDropdownItem>
              ))}
            </OLDropdownMenu>

          </OLDropdown>
          <span>{t('per_page')}</span>
        </span>
    </div>
  )
}
