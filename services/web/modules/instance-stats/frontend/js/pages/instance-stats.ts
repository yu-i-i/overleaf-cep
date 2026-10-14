import { fetchSeries } from '../features/instance-stats/api'
import { STAT_CONFIG } from '../features/instance-stats/config'
import { renderChart } from '../features/instance-stats/render'
import type { TabId, WindowKey } from '../features/instance-stats/types'

const WINDOW_VALUES: WindowKey[] = ['month', '6m', 'year', 'all']

function getWindowValue(select: HTMLSelectElement): WindowKey {
  const value = select.value as WindowKey
  if (WINDOW_VALUES.includes(value)) return value
  return 'month'
}

function getTabIdFromHash(): TabId {
  const hash = window.location.hash?.replace(/^#/, '') || ''
  if (hash === 'user' || hash === 'project' || hash === 'storage') return hash
  return 'user'
}

async function initInstanceStatsPage() {
  const root = document.getElementById('instance-stats-root')
  const select = document.getElementById('timeFilter') as HTMLSelectElement | null
  if (!root || !select) return

  let requestId = 0

  const renderWindow = async (window: WindowKey, tabId: TabId) => {
    const myRequestId = ++requestId
    const jobs = STAT_CONFIG.filter(stat => stat.tabId === tabId).map(async stat => {
      const series = await fetchSeries(stat.metric, window)
      if (myRequestId !== requestId) return
      await renderChart(stat, series.points)
    })
    await Promise.allSettled(jobs)
  }

  const renderActiveTab = () => {
    const tabId = getTabIdFromHash()
    // Delay a tick so the bootstrap tab pane is visible before Plotly sizes
    // the chart container.
    setTimeout(() => void renderWindow(getWindowValue(select), tabId), 0)
  }

  select.addEventListener('change', () => {
    renderActiveTab()
  })

  window.addEventListener('hashchange', () => {
    // Bookmarkable tabs update the hash first; wait a tick before rerender.
    renderActiveTab()
  })

  // Initial render based on current hash.
  renderActiveTab()
}

void initInstanceStatsPage()

