import type { SeriesResponse, StatKey, WindowKey } from './types'

function isSeriesResponse(value: unknown): value is SeriesResponse {
  if (!value || typeof value !== 'object') return false
  const asRecord = value as Record<string, unknown>
  return (
    typeof asRecord.metric === 'string' &&
    typeof asRecord.window === 'string' &&
    Array.isArray(asRecord.points)
  )
}

export async function fetchSeries(
  metric: StatKey,
  window: WindowKey
): Promise<SeriesResponse> {
  const url = `/admin/instance-stats/api/series?metric=${encodeURIComponent(metric)}&window=${encodeURIComponent(window)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const message = await res.text().catch(() => '')
    throw new Error(`Failed to fetch ${metric} (${res.status}): ${message}`)
  }
  const json = await res.json()
  if (!isSeriesResponse(json)) {
    throw new Error(`Invalid response shape for metric ${metric}`)
  }
  return json
}

