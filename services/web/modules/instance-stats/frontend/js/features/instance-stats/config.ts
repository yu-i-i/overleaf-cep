import type { StatConfig, WindowKey } from './types'

const passThrough = (value: number) => value
const bytesToMB = (bytes: number) => bytes / (1024 * 1024)
const bytesToGB = (bytes: number) => bytes / (1024 * 1024 * 1024)

export const WINDOW_OPTIONS: Array<{ value: WindowKey; label: string }> = [
  { value: 'month', label: 'Last 1 month' },
  { value: '6m', label: 'Last 6 months' },
  { value: 'year', label: 'Last 1 year' },
  { value: 'all', label: 'All' },
]

export const STAT_CONFIG: StatConfig[] = [
  {
    id: 'active-projects',
    metric: 'active_projects',
    tabId: 'project',
    title: 'Active projects',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#acbce2' },
    labels: {},
  },
  {
    id: 'active-users',
    metric: 'active_users',
    tabId: 'user',
    title: 'Active users',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#d98c8c' },
    labels: {},
  },
  {
    id: 'new-users',
    metric: 'new_users',
    tabId: 'user',
    title: 'New users',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#d98c8c' },
    labels: {},
  },
  {
    id: 'user-count',
    metric: 'user_count',
    tabId: 'user',
    title: 'Users',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#d98c8c' },
    labels: {},
  },
  {
    id: 'project-count',
    metric: 'project_count',
    tabId: 'project',
    title: 'Projects',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#acbce2' },
    labels: {},
  },
  {
    id: 'file-count',
    metric: 'file_count',
    tabId: 'project',
    title: 'Files',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#767676' },
    labels: {},
  },
  {
    id: 'shared-projects',
    metric: 'shared_projects',
    tabId: 'project',
    title: 'Projects with an external share token',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#94b3c9' },
    labels: {},
  },
  {
    id: 'mongodb-storage',
    metric: 'mongodb_storage',
    tabId: 'storage',
    title: 'Mongodb storage',
    ylabel: 'MB',
    seriesCount: 1,
    transform: bytesToMB,
    colors: { y1: '#767676' },
    labels: {},
  },
  {
    id: 'overleaf-storage',
    metric: 'overleaf_storage',
    tabId: 'storage',
    title: 'Overleaf storage',
    ylabel: 'GB',
    seriesCount: 1,
    transform: bytesToGB,
    colors: { y1: '#767676' },
    labels: {},
  },
  {
    id: 'redis-storage',
    metric: 'redis_storage',
    tabId: 'storage',
    title: 'Redis storage',
    ylabel: 'MB',
    seriesCount: 2,
    transform: bytesToMB,
    colors: { y1: '#767676', y2: '#ADADAD' },
    labels: { y1: 'Disk', y2: 'RAM' },
  },
  // System tab: host-level metrics
  {
    id: 'disk-usage',
    metric: 'disk_usage',
    tabId: 'system',
    title: '/var/lib/overleaf disk usage',
    ylabel: 'GB',
    seriesCount: 2,
    transform: bytesToGB,
    colors: { y1: '#767676', y2: '#ADADAD' },
    labels: { y1: 'Available', y2: 'Total' },
  },
  {
    id: 'ram-usage',
    metric: 'ram_usage',
    tabId: 'system',
    title: 'RAM usage',
    ylabel: 'GB',
    seriesCount: 2,
    transform: bytesToGB,
    colors: { y1: '#767676', y2: '#ADADAD' },
    labels: { y1: 'Free', y2: 'Used' },
  },
  {
    id: 'cpu-load',
    metric: 'cpu_load',
    tabId: 'system',
    title: 'CPU load (1 min load average)',
    ylabel: 'load per core',
    seriesCount: 1,
    chartType: 'line',
    transform: passThrough,
    colors: { y1: '#94b3c9' },
    labels: {},
  },
]

// The page renders these as time-series (date X-axis) line charts; `bar`
// can be opted into per-metric via `chartType`. Default is 'line'.
export function getSeriesConfig(): StatConfig[] {
  return STAT_CONFIG
}

