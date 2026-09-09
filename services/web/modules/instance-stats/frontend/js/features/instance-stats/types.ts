export type WindowKey = 'month' | '6m' | 'year' | 'all'

export type TabId = 'user' | 'project' | 'storage' | 'system'

export type StatKey =
  | 'active_projects'
  | 'active_users'
  | 'new_users'
  | 'shared_projects'
  | 'user_count'
  | 'project_count'
  | 'file_count'
  | 'mongodb_storage'
  | 'overleaf_storage'
  | 'redis_storage'
  | 'disk_usage'
  | 'cpu_load'
  | 'ram_usage'

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
  /** 'line' (default, time-series) or 'bar' */
  chartType?: 'bar' | 'line'
  transform: (value: number) => number
  colors: { y1: string; y2?: string }
  labels: { y1?: string; y2?: string }
}

