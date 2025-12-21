import {
  filter as arrayFilter,
} from 'lodash'
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
import {
  GetProjectsResponseBody,
  Project,
  Sort,
} from '../../../../types/project/api'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import useAsync from '@/shared/hooks/use-async'
import { getProjects } from '../util/api'
import sortProjects from '../util/sort-projects'
import { debugConsole } from '@/utils/debugging'

const MAX_PROJECT_PER_PAGE = 20

export type Filter = 'owned' | 'trashed' | 'deleted'
type FilterMap = {
  [key in Filter]: Partial<Project> | ((project: Project) => boolean)
}
const filters: FilterMap = {
  owned: {
    trashed: false,
    deleted: false,
  },
  trashed: {
    trashed: true,
    deleted: false,
  },
  deleted: {
    deleted: true,
  },
}

export type ProjectListContextValue = {
  selectOrUnselectAllProjects: React.Dispatch<React.SetStateAction<boolean>>
  visibleProjects: Project[]
  totalProjectsCount: number
  error: Error | null
  isLoading: ReturnType<typeof useAsync>['isLoading']
  loadProgress: number
  sort: Sort
  setSort: React.Dispatch<React.SetStateAction<Sort>>
  filter: Filter
  selectFilter: (filter: Filter) => void
  updateProjectViewData: (newProjectData: Project) => void
  removeProjectFromView: (project: Project) => void
  searchText: string
  setSearchText: React.Dispatch<React.SetStateAction<string>>
  selectedProjects: Project[]
  selectedProjectIds: Set<string>
  setSelectedProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>
  toggleSelectedProject: (projectId: string, selected?: boolean) => void
  hiddenProjectsCount: number
  loadMoreCount: number
  showAllProjects: () => void
  loadMoreProjects: () => void
  hasLeavableProjectsSelected: boolean
  hasDeletableProjectsSelected: boolean
}

export const ProjectListContext = createContext<
  ProjectListContextValue | undefined
>(undefined)

type ProjectListProviderProps = {
  userId: string
  children: ReactNode
}

export function ProjectListProvider({ userId, children }: ProjectListProviderProps) {
  const [loadedProjects, setLoadedProjects] = useState<Project[]>([])
  const [visibleProjects, setVisibleProjects] = useState<Project[]>([])
  const [maxVisibleProjects, setMaxVisibleProjects] =
    useState(MAX_PROJECT_PER_PAGE)
  const [hiddenProjectsCount, setHiddenProjectsCount] = useState(0)
  const [loadMoreCount, setLoadMoreCount] = useState(0)
  const [loadProgress, setLoadProgress] = useState(20)
  const [totalProjectsCount, setTotalProjectsCount] = useState<number>(0)
  const [sort, setSort] = useState<Sort>({
    by: 'lastUpdated',
    order: 'desc',
  })
  const [filter, setFilter] = usePersistedState<Filter>(
    'project-list-filter',
    'owner'
  )
  const prevSortRef = useRef<Sort>(sort)

  const [searchText, setSearchText] = useState('')

  const {
    isLoading: loading,
    isIdle,
    error,
    runAsync,
  } = useAsync<GetProjectsResponseBody>({
    status: 'pending',
    data: null,
  })
  const isLoading = isIdle ? true : loading

  useEffect(() => {
    if (!userId) return
    setLoadProgress(40)
    runAsync(getProjects({ userId: userId, by: 'lastUpdated', order: 'desc' }))
      .then(data => {
        setLoadedProjects(data.projects)
        setTotalProjectsCount(data.totalSize)
      })
      .catch(debugConsole.error)
      .finally(() => {
        setLoadProgress(100)
      })
  }, [userId, runAsync])

  useEffect(() => {
    let filteredProjects = [...loadedProjects]

    if (searchText.length) {
      filteredProjects = filteredProjects.filter(project =>
        project.name.toLowerCase().includes(searchText.toLowerCase())
      )
    }

    filteredProjects = arrayFilter(filteredProjects, filters[filter])

    if (prevSortRef.current !== sort) {
      filteredProjects = sortProjects(filteredProjects, sort)
      const loadedProjectsSorted = sortProjects(loadedProjects, sort)
      setLoadedProjects(loadedProjectsSorted)
    }

    if (filteredProjects.length > maxVisibleProjects) {
      const visibleFilteredProjects = filteredProjects.slice(
        0,
        maxVisibleProjects
      )

      const hiddenFilteredProjectsCount =
        filteredProjects.slice(maxVisibleProjects).length

      setVisibleProjects(visibleFilteredProjects)
      setHiddenProjectsCount(hiddenFilteredProjectsCount)

      if (hiddenFilteredProjectsCount > MAX_PROJECT_PER_PAGE) {
        setLoadMoreCount(MAX_PROJECT_PER_PAGE)
      } else {
        setLoadMoreCount(hiddenFilteredProjectsCount)
      }
    } else {
      setVisibleProjects(filteredProjects)
      setLoadMoreCount(0)
      setHiddenProjectsCount(0)
    }
  }, [
    loadedProjects,
    maxVisibleProjects,
    filter,
    setFilter,
    searchText,
    sort,
  ])

  useEffect(() => {
    prevSortRef.current = sort
  }, [sort])

  const showAllProjects = useCallback(() => {
    setLoadMoreCount(0)
    setHiddenProjectsCount(0)
    setMaxVisibleProjects(maxVisibleProjects + hiddenProjectsCount)
  }, [hiddenProjectsCount, maxVisibleProjects])

  const loadMoreProjects = useCallback(() => {
    setMaxVisibleProjects(maxVisibleProjects + loadMoreCount)
  }, [maxVisibleProjects, loadMoreCount])

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
    (checked: any) => {
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
      const selected = false
      selectOrUnselectAllProjects(selected)
    },
    [selectOrUnselectAllProjects, setFilter]
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
      loadMoreCount,
      loadMoreProjects,
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
      showAllProjects,
      sort,
      toggleSelectedProject,
      totalProjectsCount,
      updateProjectViewData,
      userId,
      visibleProjects,
    }),
    [
      error,
      filter,
      hiddenProjectsCount,
      isLoading,
      loadMoreCount,
      loadMoreProjects,
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
      showAllProjects,
      sort,
      toggleSelectedProject,
      totalProjectsCount,
      userId,
      updateProjectViewData,
      visibleProjects,
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
