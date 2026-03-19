import type { StatConfig, WindowKey } from './types'

const passThrough = (value: number) => value
const bytesToMB = (bytes: number) => bytes / (1024 * 1024)

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
    title: 'Active projects',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#acbce2' },
    labels: {},
  },
  {
    id: 'active-users',
    metric: 'active_users',
    title: 'Active users',
    seriesCount: 2,
    transform: passThrough,
    colors: { y1: '#d98c8c', y2: '#EDC9C9' },
    labels: { y1: 'Internal', y2: 'External' },
  },
  {
    id: 'user-count',
    metric: 'user_count',
    title: 'Users',
    seriesCount: 2,
    transform: passThrough,
    colors: { y1: '#d98c8c', y2: '#EDC9C9' },
    labels: { y1: 'Internal', y2: 'External' },
  },
  {
    id: 'project-count',
    metric: 'project_count',
    title: 'Projects',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#acbce2' },
    labels: {},
  },
  {
    id: 'file-count',
    metric: 'file_count',
    title: 'Files',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#767676' },
    labels: {},
  },
  {
    id: 'history-blobs',
    metric: 'history_blobs',
    title: 'History blobs',
    seriesCount: 1,
    transform: passThrough,
    colors: { y1: '#acbce2' },
    labels: {},
  },
  {
    id: 'mongodb-storage',
    metric: 'mongodb_storage',
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
    title: 'Overleaf storage',
    ylabel: 'MB',
    seriesCount: 1,
    transform: bytesToMB,
    colors: { y1: '#767676' },
    labels: {},
  },
  {
    id: 'redis-storage',
    metric: 'redis_storage',
    title: 'Redis storage',
    ylabel: 'MB',
    seriesCount: 2,
    transform: bytesToMB,
    colors: { y1: '#767676', y2: '#ADADAD' },
    labels: { y1: 'Disk', y2: 'RAM' },
  },
  {
    id: 'collaborators',
    metric: 'collaborators',
    title: 'Collaborators',
    seriesCount: 2,
    transform: passThrough,
    colors: { y1: '#d98c8c', y2: '#EDC9C9' },
    labels: { y1: 'Internal', y2: 'External' },
  },
]

