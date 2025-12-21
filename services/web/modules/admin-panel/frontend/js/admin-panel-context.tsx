import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react'
import { UserRef } from '../../types/project/api'

export type PageState =
  | { type: 'users' }
  | { type: 'projects'; user: UserRef }

type AdminPanelContextValue = {
  page: PageState
  showUsers: () => void
  showProjects: (user: UserRef) => void
}

const AdminPanelContext =
  createContext<AdminPanelContextValue | null>(null)

type ProviderProps = {
  children: ReactNode
}

export function AdminPanelProvider({ children }: ProviderProps) {
  const [page, setPage] = useState<PageState>({ type: 'users' })

  useEffect(() => {
    if (history.state) {
      setPage(history.state as PageState)
    } else {
      const state: PageState = { type: 'users' }
      history.replaceState(state, '')
      setPage(state)
    }

    const onPopState = (e: PopStateEvent) => {
      setPage(e.state ?? { type: 'users' })
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const showUsers = useCallback(() => {
    const state: PageState = { type: 'users' }
    history.pushState(state, '')
    setPage(state)
  }, [])

  const showProjects = useCallback((user: UserRef) => {
    const state: PageState = { type: 'projects', user }
    history.pushState(state, '')
    setPage(state)
  }, [])

  return (
    <AdminPanelContext.Provider
      value={{ page, showUsers, showProjects }}
    >
      {children}
    </AdminPanelContext.Provider>
  )
}

export function useAdminPanelContext(): AdminPanelContextValue {
  const context = useContext(AdminPanelContext)
  if (!context) {
    throw new Error('AdminPanelContext is only available inside AdminPanelProvider')
  }
  return context
}
