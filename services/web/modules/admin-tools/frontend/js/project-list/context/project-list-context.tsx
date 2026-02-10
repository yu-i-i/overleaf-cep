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
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import useAsync from '@/shared/hooks/use-async'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import {
  GetProjectsResponseBody,
  Project,
  Sort,
} from '../../../../types/project/api'
import { getProjects } from '../util/api'
import { useUserIdentityContext } from '../../user-list/context/user-identity-context'
import sortProjects from '../util/sort-projects'

export type Filter = 'owned' | 'trashed' | 'deleted' | 'inactive'

type FilterMap = {
  [key in Filter]: Partial<Project> | ((project: Project) => boolean)
}

const filters: FilterMap = {
  owned: (project) =>
    project.deleted === false &&
    project.trashed === false &&
    project.owner != null,

  trashed: (project) =>
    project.deleted === false &&
    project.trashed === true &&
    project.owner != null,

  deleted: (project) =>
    project.deleted === true,

  inactive: (project) =>
    project.deleted === false &&
    project.trashed === false &&
    project.inactive === true,
}

export type ProjectListContextValue = {
  error: Error | null
  filter: Filter
  hiddenProjectsCount: number
  isLoading: ReturnType<typeof useAsync>['isLoading']
  loadProgress: number
  removeProjectFromView: (project: Project) => void
  selectFilter: (filter: Filter) => void
  selectedProjectIds: Set<string>
  selectedProjects: Project[]
  selectOrUnselectAllProjects: React.Dispatch<React.SetStateAction<boolean>>
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
  projectsPerPage: number,
  setProjectsPerPage: React.Dispatch<React.SetStateAction<number>>,
}

export const ProjectListContext = createContext<
  ProjectListContextValue | undefined
>(undefined)

type ProjectListProviderProps = {
  projectsOwnerId: string | null
  children: ReactNode
}

export function ProjectListProvider({ projectsOwnerId, children }: ProjectListProviderProps) {
  const { getUserById } = useUserIdentityContext()

  const prefetchedProjectsBlob = projectsOwnerId ? null : getMeta('ol-prefetchedProjectsBlob')
  const [loadedProjects, setLoadedProjects] = useState<Project[]>(
    prefetchedProjectsBlob?.projects ?? []
  )

  const [loadProgress, setLoadProgress] = useState(
    prefetchedProjectsBlob ? 100 : 20
  )

  const [totalProjectsCount, setTotalProjectsCount] = useState<number>(
    prefetchedProjectsBlob?.totalSize ?? 0
  )

  const [filter, setFilter] = usePersistedState<Filter>(
    'admin-project-list-filter',
    'owned'
  )
  const [sort, setSort] = useState<Sort>({
    by: filter === 'deleted' ? 'deletedAt' : 'lastUpdated',
    order: 'desc',
  })
  const prevSortRef = useRef<Sort>(sort)

  const [searchText, setSearchTextState] = useState('')
  const lastNonSearchPageRef = useRef(1)
  const isSearchingRef = useRef(false)

  const [currentPage, setCurrentPage] = useState(1)

  const setSearchText: React.Dispatch<React.SetStateAction<string>> = value => {
    setSearchTextState(prev => {
      const nextValue =
        typeof value === 'function' ? value(prev) : value

      const wasSearching = isSearchingRef.current
      const willSearch = nextValue.length > 0

      if (!wasSearching && willSearch) {
        lastNonSearchPageRef.current = currentPage
        isSearchingRef.current = true
        setCurrentPage(1)
      } else if (wasSearching && !willSearch) {
        isSearchingRef.current = false
        setCurrentPage(lastNonSearchPageRef.current)
      }

      return nextValue
    })
  }

  const {
    isLoading: loading,
    isIdle,
    error,
    runAsync,
  } = useAsync<GetProjectsResponseBody>({
    status: prefetchedProjectsBlob ? 'resolved' : 'pending',
    data: prefetchedProjectsBlob,
  })

  const isLoading = isIdle ? true : loading

  useEffect(() => {
    if (prefetchedProjectsBlob) return

    setLoadProgress(40)
    runAsync(getProjects({ userId: projectsOwnerId, by: 'lastUpdated', order: 'desc' }))
      .then(data => {
        setLoadedProjects(data.projects)
        setTotalProjectsCount(data.totalSize)
      })
      .catch(debugConsole.error)
      .finally(() => {
        setLoadProgress(100)
      })
  }, [projectsOwnerId, runAsync, prefetchedProjectsBlob])

  const sortedProjects = useMemo(() => {
    if (
      prevSortRef.current.by === sort.by &&
      prevSortRef.current.order === sort.order
    ) {
      return loadedProjects
    }

    const sorted = sortProjects(loadedProjects, sort, getUserById)
    prevSortRef.current = sort
    return sorted
  }, [loadedProjects, sort, getUserById])

  const filteredProjects = useMemo(() => {
    const predicate = filters[filter]
    const hasSearch = searchText.length > 0
    const lower = hasSearch ? searchText.toLowerCase() : null

    return sortedProjects.filter(project => {
      if (hasSearch) {
        if (!project.name.toLowerCase().includes(lower!)) {
          return false
        }
      }

      return typeof predicate === 'function'
        ? predicate(project)
        : true
    })
  }, [sortedProjects, searchText, filter])

  const [projectsPerPage, setProjectsPerPage] = useState(20)
  const previousProjectsPerPageRef = useRef(projectsPerPage)

  useEffect(() => {
    const previousProjectsPerPage = previousProjectsPerPageRef.current

    if (previousProjectsPerPage !== projectsPerPage) {
      const oldStartIndex = (currentPage - 1) * previousProjectsPerPage
      const newPage = Math.floor(oldStartIndex / projectsPerPage) + 1
      setCurrentPage(newPage)
      previousProjectsPerPageRef.current = projectsPerPage
    }
  }, [projectsPerPage])

  const totalPages = Math.ceil(filteredProjects.length / projectsPerPage)
  const startIndex = (currentPage - 1) * projectsPerPage

  const visibleProjects = useMemo(() => {
    return filteredProjects.slice(startIndex, startIndex + projectsPerPage)
  }, [filteredProjects, startIndex, projectsPerPage])

  const hiddenProjectsCount = Math.max(
    filteredProjects.length - visibleProjects.length,
    0
  )

  const [selectedProjectIds, setSelectedProjectIds] = useState(
    () => new Set<string>()
  )

  const toggleSelectedProject = useCallback(
    (projectId: string, selected?: boolean) => {
      setSelectedProjectIds(prevSelectedProjectIds => {
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
    return visibleProjects.filter(project => selectedProjectIds.has(project.id))
  }, [selectedProjectIds, visibleProjects])

  const selectOrUnselectAllProjects = useCallback(
    (checked: boolean) => {
      setSelectedProjectIds(prevSelectedProjectIds => {
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
      selectOrUnselectAllProjects(false)
      setCurrentPage(1)

      setSort(prev => {
        if (filter === 'deleted' && prev.by === 'lastUpdated') {
          return { ...prev, by: 'deletedAt' }
        }
        if (filter !== 'deleted' && prev.by === 'deletedAt') {
          return { ...prev, by: 'lastUpdated' }
        }
        return prev
      })
    },
    [selectOrUnselectAllProjects]
  )

  const updateProjectViewData = useCallback((newProjectData: Project) => {
    setLoadedProjects(loadedProjects => {
      return loadedProjects.map(p =>
        p.id === newProjectData.id ? { ...newProjectData } : p
      )
    })
  }, [])

  const removeProjectFromView = useCallback((project: Project) => {
    setLoadedProjects(loadedProjects => {
      return loadedProjects.filter(p => p.id !== project.id)
    })
  }, [])

  const value = useMemo<ProjectListContextValue>(
    () => ({
      error,
      filter,
      hiddenProjectsCount,
      isLoading,
      loadProgress,
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
      setProjectsPerPage
    }),
    [
      error,
      filter,
      hiddenProjectsCount,
      isLoading,
      loadProgress,
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
      setProjectsPerPage
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
