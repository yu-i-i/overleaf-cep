import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import {
  GetProjectsResponseBody,
  Project,
  Sort,
} from '../../../../types/project/api'
import { getProjects } from '../util/api'

export type Filter = 'owned' | 'trashed' | 'deleted' | 'inactive'

export type ProjectListContextValue = {
  error: Error | null
  filter: Filter
  hiddenProjectsCount: number
  isLoading: boolean
  hasLoaded: boolean
  appliedSort: Sort | null
  showSortProgress: boolean
  removeProjectFromView: (project: Project) => void
  selectFilter: (filter: Filter) => void
  selectedProjectIds: Set<string>
  selectedProjects: Project[]
  selectOrUnselectAllProjects: (checked: boolean) => void
  searchText: string
  setSearchText: React.Dispatch<React.SetStateAction<string>>
  setSelectedProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSort: React.Dispatch<React.SetStateAction<Sort>>
  sort: Sort
  toggleSelectedProject: (projectId: string, selected?: boolean) => void
  totalProjectsCount: number
  projectsOwnerId: string | null
  updateProjectViewData: (newProjectData: Project) => void
  visibleProjects: Project[]
  currentPage: number
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>
  totalPages: number
  projectsPerPage: number
  setProjectsPerPage: React.Dispatch<React.SetStateAction<number>>
}

export const ProjectListContext = createContext<
  ProjectListContextValue | undefined
>(undefined)

type ProjectListProviderProps = {
  projectsOwnerId: string | null
  children: ReactNode
}

export function ProjectListProvider({
  projectsOwnerId,
  children,
}: ProjectListProviderProps) {
  const [filter, setFilter] = usePersistedState<Filter>(
    'admin-project-list-filter',
    'owned'
  )
  const [sort, setSort] = useState<Sort>({
    by: filter === 'deleted' ? 'deletedAt' : 'lastUpdated',
    order: 'desc',
  })
  const [searchText, setSearchTextState] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [projectsPerPage, setProjectsPerPageState] = useState(20)
  const [revision, setRevision] = useState(0)
  const [selectedProjectIds, setSelectedProjectIds] = useState(
    () => new Set<string>()
  )
  const [response, setResponse] = useState<{
    key: string
    sort: Sort
    data: GetProjectsResponseBody
  } | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const lastNonSearchPageRef = useRef(1)

  const setSearchText = useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (value) => {
      const next = typeof value === 'function' ? value(searchText) : value
      if (next === searchText) return
      if (!searchText && next) lastNonSearchPageRef.current = currentPage
      setCurrentPage(next ? 1 : lastNonSearchPageRef.current)
      setSearchTextState(next)
    },
    [searchText, currentPage]
  )

  const setProjectsPerPage = useCallback<
    React.Dispatch<React.SetStateAction<number>>
  >(
    (value) => {
      const size = typeof value === 'function' ? value(projectsPerPage) : value
      setCurrentPage(
        (page) => Math.floor(((page - 1) * projectsPerPage) / size) + 1
      )
      lastNonSearchPageRef.current =
        Math.floor(
          ((lastNonSearchPageRef.current - 1) * projectsPerPage) / size
        ) + 1
      setProjectsPerPageState(size)
    },
    [projectsPerPage]
  )

  useEffect(() => {
    setCurrentPage(1)
    lastNonSearchPageRef.current = 1
  }, [projectsOwnerId])

  const request = useMemo(
    () => ({
      userId: projectsOwnerId,
      filters: { [filter]: true, search: searchText },
      sort,
      page: { number: currentPage, size: projectsPerPage },
    }),
    [projectsOwnerId, filter, searchText, sort, currentPage, projectsPerPage]
  )
  const requestKey = JSON.stringify(request)

  useEffect(() => {
    setSelectedProjectIds(new Set())
  }, [requestKey])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    getProjects(request)
      .then((data) => {
        if (cancelled) return
        // The last page can disappear after an action or a concurrent deletion.
        const key = JSON.stringify({ ...request, page: data.page })
        setResponse({ key, sort: request.sort, data })
        setCurrentPage(data.page.number)
      })
      .catch((error) => {
        if (cancelled) return
        setError(error)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [request, requestKey, revision])

  // Keep the last successful page visible until its replacement is ready.
  const visibleProjects = useMemo(
    () => response?.data.projects ?? [],
    [response]
  )
  const hasLoaded = response !== null
  const appliedSort = response?.sort ?? null
  const sortPending =
    !!appliedSort &&
    !error &&
    (appliedSort.by !== sort.by || appliedSort.order !== sort.order)
  const [sortProgressDelayElapsed, setSortProgressDelayElapsed] = useState(false)
  const showSortProgress = sortPending && sortProgressDelayElapsed

  // Delay the indicator so fast sorting requests do not flash the header.
  useEffect(() => {
    if (!sortPending) {
      setSortProgressDelayElapsed(false)
      return
    }
    const timeout = window.setTimeout(() => setSortProgressDelayElapsed(true), 180)
    return () => window.clearTimeout(timeout)
  }, [sortPending, sort.by, sort.order])
  const totalProjectsCount = response?.data.totalSize ?? 0
  const totalPages = Math.ceil(totalProjectsCount / projectsPerPage)
  const hiddenProjectsCount = Math.max(
    totalProjectsCount - visibleProjects.length,
    0
  )

  const toggleSelectedProject = useCallback(
    (projectId: string, selected?: boolean) => {
      setSelectedProjectIds((prevSelectedProjectIds) => {
        const selectedProjectIds = new Set(prevSelectedProjectIds)
        if (selected === true) {
          selectedProjectIds.add(projectId)
        } else if (selected === false) {
          selectedProjectIds.delete(projectId)
        } else if (selectedProjectIds.has(projectId)) {
          selectedProjectIds.delete(projectId)
        } else {
          selectedProjectIds.add(projectId)
        }
        return selectedProjectIds
      })
    },
    []
  )

  const selectedProjects = useMemo(() => {
    if (response?.key !== requestKey) return []
    return visibleProjects.filter((project) =>
      selectedProjectIds.has(project.id)
    )
  }, [selectedProjectIds, visibleProjects, response, requestKey])

  const selectOrUnselectAllProjects = useCallback(
    (checked: boolean) => {
      setSelectedProjectIds((prevSelectedProjectIds) => {
        const selectedProjectIds = new Set(prevSelectedProjectIds)
        for (const project of visibleProjects) {
          if (checked) {
            selectedProjectIds.add(project.id)
          } else {
            selectedProjectIds.delete(project.id)
          }
        }
        return selectedProjectIds
      })
    },
    [visibleProjects]
  )

  const selectFilter = useCallback(
    (filter: Filter) => {
      setFilter(filter)
      setSelectedProjectIds(new Set())
      lastNonSearchPageRef.current = 1
      setCurrentPage(1)

      setSort((prev) => {
        if (filter === 'deleted' && prev.by === 'lastUpdated') {
          return { ...prev, by: 'deletedAt' }
        }
        if (filter !== 'deleted' && prev.by === 'deletedAt') {
          return { ...prev, by: 'lastUpdated' }
        }
        return prev
      })
    },
    [setFilter]
  )

  // Re-query after mutations: membership, order, totals and page boundaries may change.
  const updateProjectViewData = useCallback((_project: Project) => {
    setRevision((revision) => revision + 1)
  }, [])
  const removeProjectFromView = updateProjectViewData

  const value = useMemo<ProjectListContextValue>(
    () => ({
      error,
      filter,
      hiddenProjectsCount,
      isLoading,
      hasLoaded,
      appliedSort,
      showSortProgress,
      removeProjectFromView,
      selectFilter,
      selectedProjects,
      selectedProjectIds,
      selectOrUnselectAllProjects,
      searchText,
      setSearchText,
      setSelectedProjectIds,
      setSort,
      sort,
      toggleSelectedProject,
      totalProjectsCount,
      updateProjectViewData,
      projectsOwnerId,
      visibleProjects,
      currentPage,
      setCurrentPage,
      totalPages,
      projectsPerPage,
      setProjectsPerPage,
    }),
    [
      error,
      filter,
      hiddenProjectsCount,
      isLoading,
      hasLoaded,
      appliedSort,
      showSortProgress,
      removeProjectFromView,
      selectFilter,
      selectedProjectIds,
      selectedProjects,
      selectOrUnselectAllProjects,
      searchText,
      setSearchText,
      setSelectedProjectIds,
      setSort,
      sort,
      toggleSelectedProject,
      totalProjectsCount,
      projectsOwnerId,
      updateProjectViewData,
      visibleProjects,
      currentPage,
      setCurrentPage,
      totalPages,
      projectsPerPage,
      setProjectsPerPage,
    ]
  )

  return (
    <ProjectListContext.Provider value={value}>
      {children}
    </ProjectListContext.Provider>
  )
}

export function useProjectListContext() {
  const context = useContext(ProjectListContext)
  if (!context) {
    throw new Error(
      'ProjectListContext is only available inside ProjectListProvider'
    )
  }
  return context
}
