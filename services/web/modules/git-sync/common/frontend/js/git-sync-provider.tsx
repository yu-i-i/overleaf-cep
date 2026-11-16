import { createContext, useContext, useCallback, type ComponentType, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type GitSyncConfig = {
  provider: string
  providerName: string
  displayTitle?: string
  basePath: string
  Logo: ComponentType<{ size?: number }>
  repoUrl: (fullName: string) => string
  branchUrl: (fullName: string, branch: string) => string
  commitUrl: (fullName: string, sha: string) => string
}

const GitSyncContext = createContext<GitSyncConfig | null>(null)

export function GitSyncProvider({ config, children }: {
  config: GitSyncConfig
  children: ReactNode
}) {
  return <GitSyncContext.Provider value={config}>{children}</GitSyncContext.Provider>
}

export function useGitSync() {
  const config = useContext(GitSyncContext)
  if (!config) throw new Error('GitSyncProvider is required')
  const { t: translate } = useTranslation()

  const t = useCallback((key: string, options: Record<string, unknown> = {}) =>
    translate(key, { ...options, provider: config.providerName }), [translate, config.providerName])

  return { ...config, t }
}
