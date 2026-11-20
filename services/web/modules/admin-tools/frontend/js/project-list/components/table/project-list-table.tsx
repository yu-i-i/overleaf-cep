import { useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ProjectListTableRow from './project-list-table-row'
import { useProjectListContext } from '../../context/project-list-context'
import { useUserListContext } from '../../../user-list/context/user-list-context'
import useSort from '../../hooks/use-sort'
import withContent, { SortBtnProps } from '../sort/with-content'
import OLTable from '@/shared/components/ol/ol-table'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import MaterialIcon from '@/shared/components/material-icon'
import OLSpinner from '@/shared/components/ol/ol-spinner'

function SortBtn({
  onClick,
  text,
  iconType,
  screenReaderText,
  showSpinner,
}: SortBtnProps) {
  return (
    <button
      className="table-header-sort-btn d-none d-md-inline-flex align-items-center"
      style={{ overflow: 'visible', textOverflow: 'clip' }}
      onClick={onClick}
      aria-label={screenReaderText}
    >
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'clip',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </span>
      {(showSpinner || iconType) && (
        <span
          className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
          style={{ width: '1.5em', marginLeft: '0.15em' }}
          aria-hidden="true"
        >
          {showSpinner ? (
            <OLSpinner size="sm" />
          ) : iconType ? (
            <MaterialIcon type={iconType} />
          ) : null}
        </span>
      )}
    </button>
  )
}

const SortByButton = withContent(SortBtn)

function ProjectListTable() {
  const { t } = useTranslation()
  const {
    visibleProjects,
    hasLoaded,
    isLoading,
    error,
    sort,
    appliedSort,
    showSortProgress,
    selectedProjects,
    selectOrUnselectAllProjects,
    filter,
  } = useProjectListContext()
  const { isLoading: areUsersLoading } = useUserListContext()
  const showInitialLoading = !error && (!hasLoaded || areUsersLoading)
  const { handleSort } = useSort()
  const displayedSort = appliedSort ?? sort
  const checkAllRef = useRef<HTMLInputElement>(null)

  const handleAllProjectsCheckboxChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      selectOrUnselectAllProjects(event.target.checked)
    },
    [selectOrUnselectAllProjects]
  )

  useEffect(() => {
    if (checkAllRef.current) {
      checkAllRef.current.indeterminate =
        selectedProjects.length > 0 &&
        selectedProjects.length !== visibleProjects.length
    }
  }, [selectedProjects, visibleProjects])

  return (
    <OLTable
      className="project-dash-table"
      container={false}
      hover
      {...(isLoading || error ? { inert: '' } : {})}
    >
      <caption className="visually-hidden">{t('projects_list')}</caption>
      <thead className="visually-hidden-max-md">
        <tr>
          <th
            className="dash-cell-checkbox d-none d-md-table-cell"
            aria-label={t('select_projects')}
          >
            <OLFormCheckbox
              name="select_all_projects"
              autoComplete="off"
              onChange={handleAllProjectsCheckboxChange}
              checked={
                visibleProjects.length === selectedProjects.length &&
                visibleProjects.length !== 0
              }
              disabled={visibleProjects.length === 0}
              aria-label={t('select_all_projects')}
              inputRef={checkAllRef}
            />
          </th>
          <th
            className="dash-cell-name"
            aria-label={t('title')}
            aria-sort={
              displayedSort.by === 'title'
                ? displayedSort.order === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined
            }
          >
            <SortByButton
              column="title"
              text={t('title')}
              sort={sort}
              appliedSort={appliedSort}
              showSortProgress={showSortProgress}
              onClick={() => handleSort('title')}
            />
          </th>
          <th
            className="dash-cell-date-owner d-md-none"
            aria-label={t('date_and_owner')}
          >
            {t('date_and_owner')}
          </th>
          <th
            className="dash-cell-owner d-none d-md-table-cell"
            aria-label={t('owner')}
            aria-sort={
              displayedSort.by === 'owner'
                ? displayedSort.order === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined
            }
          >
            <SortByButton
              column="owner"
              text={t('owner')}
              sort={sort}
              appliedSort={appliedSort}
              showSortProgress={showSortProgress}
              onClick={() => handleSort('owner')}
            />
          </th>
          {filter !== 'deleted' ? (
            <th
              className="dash-cell-date d-none d-md-table-cell"
              aria-label={t('last_modified')}
              aria-sort={
                displayedSort.by === 'lastUpdated'
                  ? displayedSort.order === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
            >
              <SortByButton
                column="lastUpdated"
                text={t('last_modified')}
                sort={sort}
                appliedSort={appliedSort}
                showSortProgress={showSortProgress}
                onClick={() => handleSort('lastUpdated')}
              />
            </th>
          ) : (
            <th
              className="dash-cell-date d-none d-md-table-cell"
              aria-label={t('deleted_at')}
              aria-sort={
               displayedSort.by === 'deletedAt'
                  ? displayedSort.order === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
            >
              <SortByButton
                column="deletedAt"
                text={t('deleted_at')}
                sort={sort}
                appliedSort={appliedSort}
                showSortProgress={showSortProgress}
                onClick={() => handleSort('deletedAt')}
              />
            </th>
          )}
          <th className="dash-cell-actions" aria-label={t('actions')}>
            {t('actions')}
          </th>
        </tr>
      </thead>
      <tbody>
        {!showInitialLoading && visibleProjects.length > 0 ? (
          visibleProjects.map(p => (
            <ProjectListTableRow
              project={p}
              selected={selectedProjects.some(({ id }) => id === p.id)}
              key={p.id}
              filter={filter}
            />
          ))
        ) : (
          <tr className="no-projects">
            <td className="text-center" colSpan={6}>
              {showInitialLoading ? (
                <div className="d-flex align-items-center justify-content-center gap-2 py-3" role="status">
                  <OLSpinner size="sm" />
                  <span>{t('loading')}</span>
                </div>
              ) : hasLoaded ? t('no_projects') : null}
            </td>
          </tr>
        )}
      </tbody>
    </OLTable>
  )
}

export default ProjectListTable
