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
  filter as arrayFilter,
} from 'lodash'
import { useTranslation } from 'react-i18next'
import {
  GetUsersResponseBody,
  User,
  Sort,
} from '../../../../types/user/api'
import { debugConsole } from '@/utils/debugging'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import getMeta from '@/utils/meta'
import useAsync from '@/shared/hooks/use-async'
import { getUsers } from '../util/api'
import sortUsers from '../util/sort-users'

const MAX_USER_PER_PAGE = 10

type AuthMethods = 'local' | 'ldap' | 'saml' | 'oidc'
export type Filter = 'all' | 'admin' | 'suspended' | 'inactive' | AuthMethods | 'deleted'

const selfId = getMeta('ol-user_id')
const availableAuthMethods: AuthMethods[] = getMeta('ol-availableAuthMethods')

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
  selectOrUnselectAllUsers: React.Dispatch<React.SetStateAction<boolean>>
  visibleUsers: User[]
  totalUsersCount: number
  error: Error | null
  isLoading: ReturnType<typeof useAsync>['isLoading']
  loadProgress: number
  sort: Sort
  setSort: React.Dispatch<React.SetStateAction<Sort>>
  filter: Filter
  filterTranslations: Map<Filter, string>
  selectFilter: (filter: Filter) => void
  updateUserViewData: (newUserData: User) => void
  removeUserFromView: (user: User) => void
  addUserToView: (user: Partial<User>) => void
  searchText: string
  setSearchText: React.Dispatch<React.SetStateAction<string>>
  selectedUsers: User[]
  selectedUserIds: Set<string>
  setSelectedUserIds: React.Dispatch<React.SetStateAction<Set<string>>>
  toggleSelectedUser: (userId: string, selected?: boolean) => void
  hiddenUsersCount: number
  loadMoreCount: number
  showAllUsers: () => void
  loadMoreUsers: () => void
  selfVisibleCount: number
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
  const [visibleUsers, setVisibleUsers] = useState<User[]>([])
  const [maxVisibleUsers, setMaxVisibleUsers] =
    useState(MAX_USER_PER_PAGE)
  const [hiddenUsersCount, setHiddenUsersCount] = useState(0)
  const [loadMoreCount, setLoadMoreCount] = useState(0)
  const [loadProgress, setLoadProgress] = useState(
    prefetchedUsersBlob ? 100 : 20
  )
  const [totalUsersCount, setTotalUsersCount] = useState<number>(
    prefetchedUsersBlob?.totalSize ?? 0
  )
  const [sort, setSort] = useState<Sort>({
    by: 'signUpDate',
    order: 'desc',
  })

  const { t } = useTranslation()

  const filterTranslations = useMemo(
    () => new Map(filterKeys.map((key) => [key, t(`user_category_${key}`)])),
    [t, filterKeys]
  )

  const [filter, setFilter] = usePersistedState<Filter>(
    'user-list-filter',
    'all'
  )
  const prevSortRef = useRef<Sort>(sort)

  const [searchText, setSearchText] = useState('')

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
    runAsync(getUsers({ by: 'signUpDate', order: 'desc' }))
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
    setLoadedUsers(prev => sortUsers([newUser, ...prev], prevSortRef.current))
  }, [])

  useEffect(() => {
    let filteredUsers = [...loadedUsers]

    if (searchText.length) {
      const searchTextLowerCase = searchText.toLowerCase()
      filteredUsers = filteredUsers.filter(user =>
        user.email.toLowerCase().includes(searchTextLowerCase) ||
        user.firstName?.toLowerCase().includes(searchTextLowerCase) ||
        user.lastName?.toLowerCase().includes(searchTextLowerCase)
      )
    }

    filteredUsers = arrayFilter(filteredUsers, filters[filter])

    if (prevSortRef.current !== sort) {
      filteredUsers = sortUsers(filteredUsers, sort)
      const loadedUsersSorted = sortUsers(loadedUsers, sort)
      setLoadedUsers(loadedUsersSorted)
    }

    if (filteredUsers.length > maxVisibleUsers) {
      const visibleFilteredUsers = filteredUsers.slice(
        0,
        maxVisibleUsers
      )

      const hiddenFilteredUsersCount =
        filteredUsers.slice(maxVisibleUsers).length

      setVisibleUsers(visibleFilteredUsers)
      setHiddenUsersCount(hiddenFilteredUsersCount)

      if (hiddenFilteredUsersCount > MAX_USER_PER_PAGE) {
        setLoadMoreCount(MAX_USER_PER_PAGE)
      } else {
        setLoadMoreCount(hiddenFilteredUsersCount)
      }
    } else {
      setVisibleUsers(filteredUsers)
      setLoadMoreCount(0)
      setHiddenUsersCount(0)
    }
  }, [
    loadedUsers,
    maxVisibleUsers,
    filter,
    setFilter,
    searchText,
    sort,
  ])

  const selfVisibleCount = useMemo(() => {
    return visibleUsers.some(u => u.id === selfId) ? 1 : 0
  }, [visibleUsers, selfId])

  useEffect(() => {
    prevSortRef.current = sort
  }, [sort])

  const showAllUsers = useCallback(() => {
    setLoadMoreCount(0)
    setHiddenUsersCount(0)
    setMaxVisibleUsers(maxVisibleUsers + hiddenUsersCount)
  }, [hiddenUsersCount, maxVisibleUsers])

  const loadMoreUsers = useCallback(() => {
    setMaxVisibleUsers(maxVisibleUsers + loadMoreCount)
  }, [maxVisibleUsers, loadMoreCount])

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
    return visibleUsers.filter(user => selectedUserIds.has(user.id))
  }, [selectedUserIds, visibleUsers])

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
    } ,
    [visibleUsers]
  )

  const selectFilter = useCallback(
    (filter: Filter) => {
      setFilter(filter)
      const selected = false
      selectOrUnselectAllUsers(selected)
    },
    [selectOrUnselectAllUsers, setFilter]
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
      loadMoreCount,
      loadMoreUsers,
      loadProgress,
      removeUserFromView,
      searchText,
      selectFilter,
      selectedUsers,
      selectedUserIds,
      selectOrUnselectAllUsers,
      selfVisibleCount,
      setSearchText,
      setSelectedUserIds,
      setSort,
      showAllUsers,
      sort,
      toggleSelectedUser,
      totalUsersCount,
      updateUserViewData,
      loadedUsers,
      visibleUsers,
    }),
    [
      addUserToView,
      error,
      filter,
      filterTranslations,
      hiddenUsersCount,
      isLoading,
      loadMoreCount,
      loadMoreUsers,
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
      showAllUsers,
      sort,
      toggleSelectedUser,
      totalUsersCount,
      updateUserViewData,
      loadedUsers,
      visibleUsers,
    ]
  )

  return (
    <UserListContext.Provider value={value}>
      {children}
    </UserListContext.Provider>
  )
}

export function useUserListContext() {
  const context = useContext(UserListContext)
  if (!context) {
    throw new Error(
      'Admin Panel: UserListContext is only available inside UserListProvider'
    )
  }
  return context
}
