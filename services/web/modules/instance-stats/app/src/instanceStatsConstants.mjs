//
// Single source of truth for the instance-stats module's stat keys, series
// counts and day-bucketing helpers.
//
// Used by:
//   - InstanceStatsController.mjs (route validation + window cutoff)
//   - verifyInstanceStats.mjs (expected series length per statKey)
//   - seedInstanceStats.mjs (which statKeys to seed + their series length)
//   - collectInstanceStats.mjs (day bucketing)
//
// Keep the frontend (frontend/js/features/instance-stats/config.ts) in sync
// with STAT_KEYS / WINDOWS (there is no shared runtime between backend and
// frontend in this module).
//

// NOTE on "new_*" metrics: the CEP User schema has signUpDate, so `new_users`
// is computable. The Project and Doc schemas have no creation date (no
// `createdAt` / `created`), so `new_projects` and `new_files` are NOT
// implemented — see INTEGRATION_NOTES.md if that changes upstream.

export const STAT_KEYS = [
  'active_projects',
  'active_users',
  'new_users',
  'shared_projects',
  'user_count',
  'project_count',
  'file_count',
  'mongodb_storage',
  'overleaf_storage',
  'redis_storage',
  'disk_usage',
  'cpu_load',
  'ram_usage',
]

export const WINDOWS = {
  month: 30,
  '6m': 180,
  year: 365,
}

// Expected array length per statKey (see the InstanceStat model `values`).
//   redis_storage: [diskBytes, ramBytes]
//   disk_usage:    [availableBytes, totalBytes]
//   cpu_load:      [load1]  (single series; /proc/loadavg 1-min value)
//   ram_usage:     [freeBytes, usedBytes]
export const SERIES_COUNTS = {
  active_projects: 1,
  active_users: 1,
  new_users: 1,
  shared_projects: 1,
  user_count: 1,
  project_count: 1,
  file_count: 1,
  mongodb_storage: 1,
  overleaf_storage: 1,
  redis_storage: 2,
  disk_usage: 2,
  cpu_load: 1,
  ram_usage: 2,
}

export const DAY_MS = 24 * 60 * 60 * 1000

/** Returns UTC midnight for a given date (the day bucket used for docs). */
export function toUtcMidnight(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

/** Cutoff Date for a window relative to now (day-bucketed at UTC midnight). */
export function computeCutoff(window, now, retentionDays = 365) {
  const cutoffDays = window === 'all' ? retentionDays : (WINDOWS[window] ?? 30)
  return toUtcMidnight(new Date(now.getTime() - cutoffDays * DAY_MS))
}
