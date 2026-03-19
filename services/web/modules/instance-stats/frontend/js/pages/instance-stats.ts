import { fetchSeries } from '../features/instance-stats/api'
import { STAT_CONFIG } from '../features/instance-stats/config'
import { renderChart } from '../features/instance-stats/render'
import type { WindowKey } from '../features/instance-stats/types'

const WINDOW_VALUES: WindowKey[] = ['month', '6m', 'year', 'all']

function getWindowValue(select: HTMLSelectElement): WindowKey {
  const value = select.value as WindowKey
  if (WINDOW_VALUES.includes(value)) return value
  return 'month'
}

async function initInstanceStatsPage() {
  const root = document.getElementById('instance-stats-root')
  const select = document.getElementById('timeFilter') as HTMLSelectElement | null
  if (!root || !select) return

  let requestId = 0

  const renderWindow = async (window: WindowKey) => {
    const myRequestId = ++requestId
    const jobs = STAT_CONFIG.map(async stat => {
      const series = await fetchSeries(stat.metric, window)
      if (myRequestId !== requestId) return
      await renderChart(stat, series.points)
    })
    await Promise.allSettled(jobs)
  }

  select.addEventListener('change', () => {
    void renderWindow(getWindowValue(select))
  })

  await renderWindow(getWindowValue(select))
}

void initInstanceStatsPage()

