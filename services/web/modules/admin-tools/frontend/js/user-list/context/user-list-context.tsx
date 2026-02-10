import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react'
import {
  filter as arrayFilter,
} from 'lodash'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import useAsync from '@/shared/hooks/use-async'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import {
  GetUsersResponseBody,
  User,
  Sort,
} from '../../../../types/user/api'
import { getUsers } from '../util/api'
import sortUsers from '../util/sort-users'

import { UserIdentityProvider } from './user-identity-context'

type AuthMethods = 'local' | 'ldap' | 'saml' | 'oidc'
export type Filter = 'all' | 'admin' | 'suspended' | 'inactive' | AuthMethods | 'deleted'

const selfId = getMeta('ol-user_id')
const availableAuthMethods: AuthMethods[] = getMeta('ol-availableAuthMethods') ?? []

type FilterMap = {
  [key in Filter]: Partial<User> | ((user: User) => boolean)
}

const filters: FilterMap = {
  all: { deleted: false },
  admin: { isAdmin: true, deleted: false },
  suspended: { suspended: true, deleted: false },
  inactive: { inactive: true, deleted: false },
  deleted: { deleted: true },
  ...Object.fromEntries(
    availableAuthMethods.map(method => [
      method,
      (user: User) => user.authMethods.includes(method) && !user.deleted
    ])
  )
}

// if there is only one authentication source we won't show "users by authentication" lists
const filterKeys: Filter[] = [
  'all',
  'admin',
  'suspended',
  'inactive',
  ...(availableAuthMethods.length === 1 ? [] : availableAuthMethods),
  'deleted'
]

export type UserListContextValue = {
  addUserToView: (user: Partial<User>) => void
  error: Error | null
  filter: Filter
  filterTranslations: Map<Filter, string>
  hiddenUsersCount: number
  isLoading: ReturnType<typeof useAsync>['isLoading']
  loadProgress: number
  removeUserFromView: (user: User) => void
  searchText: string
  selectFilter: (filter: Filter) => void
  selectedUserIds: Set<string>
  selectedUsers: User[]
  selectOrUnselectAllUsers: React.Dispatch<React.SetStateAction<boolean>>
  selfVisibleCount: number
  setSearchText: React.Dispatch<React.SetStateAction<string>>
  setSelectedUserIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSort: React.Dispatch<React.SetStateAction<Sort>>
  sort: Sort
  toggleSelectedUser: (userId: string, selected?: boolean) => void
  totalUsersCount: number
  updateUserViewData: (newUserData: User) => void
  loadedUsers: User[]
  visibleUsers: User[]
  currentPage: number
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>
  totalPages: number
  usersPerPage: number,
  setUsersPerPage: React.Dispatch<React.SetStateAction<number>>,
}

export const UserListContext = createContext<
  UserListContextValue | undefined
>(undefined)

type UserListProviderProps = {
  children: ReactNode
}

export function UserListProvider({ children }: UserListProviderProps) {
  const prefetchedUsersBlob = getMeta('ol-prefetchedUsersBlob')
  const [loadedUsers, setLoadedUsers] = useState<User[]>(
    prefetchedUsersBlob?.users ?? []
  )

  const [loadProgress, setLoadProgress] = useState(
    prefetchedUsersBlob ? 100 : 20
  )
  const [totalUsersCount, setTotalUsersCount] = useState<number>(
    prefetchedUsersBlob?.totalSize ?? 0
  )
  const [sort, setSort] = useState<Sort>({
    by: 'name',
    order: 'asc',
  })

  const { t } = useTranslation()

  const filterTranslations = useMemo(
    () => new Map(filterKeys.map(key => [key, t(`user_category_${key}`)])),
    [t]
  )

  const [filter, setFilter] = usePersistedState<Filter>(
    'user-list-filter',
    'all'
  )

  const [currentPage, setCurrentPage] = useState(1)
  const [searchText, setSearchTextState] = useState('')
  const lastNonSearchPageRef = useRef(1)
  const isSearchingRef = useRef(false)

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
  } = useAsync<GetUsersResponseBody>({
    status: prefetchedUsersBlob ? 'resolved' : 'pending',
    data: prefetchedUsersBlob,
  })
  const isLoading = isIdle ? true : loading


  useEffect(() => {
    if (prefetchedUsersBlob) return
    setLoadProgress(40)
    runAsync(getUsers({ by: 'name', order: 'asc' }))
      .then(data => {
        setLoadedUsers(data.users)
        setTotalUsersCount(data.totalSize)
      })
      .catch(debugConsole.error)
      .finally(() => {
        setLoadProgress(100)
      })
  }, [prefetchedUsersBlob, runAsync])

  const addUserToView = useCallback((newUser: Partial<User>) => {
    setLoadedUsers(prev => [newUser as User, ...prev])
  }, [])

  const isDefaultSort =
    sort.by === 'name' && sort.order === 'asc'

  const filteredUsers = useMemo(() => {
    let users = loadedUsers

    if (searchText.length) {
      const searchTextLowerCase = searchText.toLowerCase()
      users = users.filter(user =>
        user.email?.toLowerCase().includes(searchTextLowerCase) ||
        user.firstName?.toLowerCase().includes(searchTextLowerCase) ||
        user.lastName?.toLowerCase().includes(searchTextLowerCase)
      )
    }

    users = arrayFilter(users, filters[filter])

    return users
  }, [loadedUsers, searchText, filter])

  const processedUsers = useMemo(() => {
    if (isDefaultSort) {
      return filteredUsers
    }

    return sortUsers(filteredUsers, sort)
  }, [filteredUsers, sort, isDefaultSort])

  const [usersPerPage, setUsersPerPage] = useState(20)
  const previousUsersPerPageRef = useRef(usersPerPage)

  useEffect(() => {
    const previousUsersPerPage = previousUsersPerPageRef.current

    if (previousUsersPerPage !== usersPerPage) {
      const oldStartIndex = (currentPage - 1) * previousUsersPerPage
      const newPage = Math.floor(oldStartIndex / usersPerPage) + 1
      setCurrentPage(newPage)
      previousUsersPerPageRef.current = usersPerPage
    }
  }, [usersPerPage])

  const totalPages = useMemo(
    () => Math.ceil(processedUsers.length / usersPerPage),
    [processedUsers.length, usersPerPage]
  )
  const startIndex = (currentPage - 1) * usersPerPage

  const visibleUsers = useMemo(() => {
    return processedUsers.slice(startIndex, startIndex + usersPerPage)
  }, [processedUsers, startIndex, usersPerPage])

  const hiddenUsersCount = Math.max(
    processedUsers.length - visibleUsers.length,
    0
  )

  const selfVisibleCount = useMemo(() => {
    return visibleUsers.some(u => u.id === selfId) ? 1 : 0
  }, [visibleUsers])

  const [selectedUserIds, setSelectedUserIds] = useState(
    () => new Set<string>()
  )

  const toggleSelectedUser = useCallback(
    (userId: string, selected?: boolean) => {
      setSelectedUserIds(prevSelectedUserIds => {
        const selectedUserIds = new Set(prevSelectedUserIds)
        if (selected === true) {
          selectedUserIds.add(userId)
        } else if (selected === false) {
          selectedUserIds.delete(userId)
        } else if (selectedUserIds.has(userId)) {
          selectedUserIds.delete(userId)
        } else {
          selectedUserIds.add(userId)
        }
        return selectedUserIds
      })
    },
    []
  )

  const selectedUsers = useMemo(() => {
    return loadedUsers.filter(user => selectedUserIds.has(user.id))
  }, [selectedUserIds, loadedUsers])

  const selectOrUnselectAllUsers = useCallback(
    (checked: any) => {
      setSelectedUserIds(prevSelectedUserIds => {
        const selectedUserIds = new Set(prevSelectedUserIds)
        for (const user of visibleUsers) {
          if (user.id === selfId) {
            selectedUserIds.delete(user.id)
            continue
          }
          if (checked) {
            selectedUserIds.add(user.id)
          } else {
            selectedUserIds.delete(user.id)
          }
        }
        return selectedUserIds
      })
    },
    [visibleUsers]
  )

  const selectFilter = useCallback(
    (filter: Filter) => {
      setFilter(filter)

      setSort(prev => {
        if (filter === 'deleted' && prev.by === 'signUpDate') {
          return { ...prev, by: 'deletedAt' }
        }
        if (filter !== 'deleted' && prev.by === 'deletedAt') {
          return { ...prev, by: 'signUpDate' }
        }
        return prev
      })

      selectOrUnselectAllUsers(false)
      setCurrentPage(1)
    },
    [selectOrUnselectAllUsers]
  )

  const updateUserViewData = useCallback((newUserData: User) => {
    setLoadedUsers(loadedUsers => {
      return loadedUsers.map(u =>
        u.id === newUserData.id ? { ...newUserData } : u
      )
    })
  }, [])

  const removeUserFromView = useCallback((user: User) => {
    setLoadedUsers(loadedUsers => {
      return loadedUsers.filter(u => u.id !== user.id)
    })
  }, [])

  const value = useMemo<UserListContextValue>(
    () => ({
      addUserToView,
      error,
      filter,
      filterTranslations,
      hiddenUsersCount,
      isLoading,
      loadProgress,
      removeUserFromView,
      searchText,
      selectFilter,
      selectedUserIds,
      selectedUsers,
      selectOrUnselectAllUsers,
      selfVisibleCount,
      setSearchText,
      setSelectedUserIds,
      setSort,
      sort,
      toggleSelectedUser,
      totalUsersCount,
      updateUserViewData,
      loadedUsers,
      visibleUsers,
      currentPage,
      setCurrentPage,
      totalPages,
      usersPerPage,
      setUsersPerPage,
    }),
    [
      addUserToView,
      error,
      filter,
      filterTranslations,
      hiddenUsersCount,
      isLoading,
      loadProgress,
      removeUserFromView,
      searchText,
      selectFilter,
      selectedUserIds,
      selectedUsers,
      selectOrUnselectAllUsers,
      selfVisibleCount,
      setSearchText,
      setSelectedUserIds,
      setSort,
      sort,
      toggleSelectedUser,
      totalUsersCount,
      updateUserViewData,
      loadedUsers,
      visibleUsers,
      currentPage,
      setCurrentPage,
      totalPages,
      usersPerPage,
      setUsersPerPage,
    ]
  )

  if (isLoading) return null

  return (
    <UserIdentityProvider users={loadedUsers}>
      <UserListContext.Provider value={value}>
        {children}
      </UserListContext.Provider>
    </UserIdentityProvider>
  )
}

export function useUserListContext() {
  const context = useContext(UserListContext)
  if (!context) {
    throw new Error(
      'UserListContext is only available inside UserListProvider'
    )
  }
  return context
}
