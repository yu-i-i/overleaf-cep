import { useTranslation } from 'react-i18next'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import { useProjectListContext } from '../context/project-list-context'

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
      <p>
        <span aria-live="polite">
          {t('showing_x_out_of_n_projects', {
            x: visibleProjects.length,
            n: visibleProjects.length + hiddenProjectsCount,
          })}
        </span>
        <span className="mx-2">·</span>
        <span className="d-inline-flex gap-1">
          <OLFormSelect
            name="projects_per_page"
            value={projectsPerPage}
            onChange={(e) => setProjectsPerPage(Number(e.target.value))}
            style={{
              width: 'auto',
              border: '1px solid #ccc',
              background: 'var(--green-10)',
              padding: '0 0.2rem',
              boxShadow: 'none',
              cursor: 'pointer',
            }}
          >
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={80}>80</option>
          </OLFormSelect>
          <span>
            {t('per_page')}
          </span>
        </span>
      </p>
    </div>
  )
}
