export type WindowKey = 'month' | '6m' | 'year' | 'all'

export type TabId = 'user' | 'project' | 'storage'

export type StatKey =
  | 'active_projects'
  | 'active_users'
  | 'user_count'
  | 'project_count'
  | 'file_count'
  | 'mongodb_storage'
  | 'overleaf_storage'
  | 'redis_storage'

export interface SeriesPoint {
  day: number
  values: number[]
}

export interface SeriesResponse {
  metric: StatKey
  window: WindowKey
  points: SeriesPoint[]
}

export interface StatConfig {
  id: string
  metric: StatKey
  tabId: TabId
  title: string
  ylabel?: string
  seriesCount: 1 | 2
  transform: (value: number) => number
  colors: { y1: string; y2?: string }
  labels: { y1?: string; y2?: string }
}

