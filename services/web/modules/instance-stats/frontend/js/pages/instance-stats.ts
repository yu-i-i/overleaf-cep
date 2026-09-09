/* Round-3 (2026-09-01, user re-report 3/4): /admin/instance-stats is a
   SINGLE SCROLLING DASHBOARD.
   - The left column (ul.user-list-filters) is ANCHOR navigation: each
     button smooth-scrolls to its H2 section and highlights as you scroll
     (same pattern as the /user/mysettings shell). No hidden tab-panes.
   - Because every section is visible, ALL charts render on load at their
     real width — the "images don't show until I press a button" bug is
     gone (there is no per-tab lazy rendering anymore).
   - Charts are line charts over a time (date) X-axis; Overleaf storage,
     disk usage and RAM usage are in GB (see config.ts).
   - The shared DS-nav chrome (navbar, account menu with the theme toggle
     now correctly re-applying the theme, footer, cookie banner) is
     unchanged. */
import { renderDsNavChrome } from '../../../../page-shells/frontend/js/components/ds-nav-chrome'
import { fetchSeries } from '../features/instance-stats/api'
import { getSeriesConfig } from '../features/instance-stats/config'
import { renderChart } from '../features/instance-stats/render'
import { initSettingsPanel } from '../features/instance-stats/settingsPanel'
import type { WindowKey } from '../features/instance-stats/types'

const WINDOW_VALUES: WindowKey[] = ['month', '6m', 'year', 'all']
const SECTION_IDS: readonly string[] = [
  'user',
  'project',
  'storage',
  'system',
  'settings',
]

function getWindowValue(select: HTMLSelectElement): WindowKey {
  const value = select.value as WindowKey
  return WINDOW_VALUES.includes(value) ? value : 'month'
}

function setActive(sectionId: string): void {
  Array.prototype.slice
    .call(document.querySelectorAll('.user-list-filters li[data-pane]'))
    .forEach(li =>
      li.classList.toggle('active', li.getAttribute('data-pane') === sectionId),
    )
}

function initAnchorNav(): void {
  const navItems = Array.prototype.slice.call(
    document.querySelectorAll('.user-list-filters li[data-pane]'),
  )

  navItems.forEach(li => {
    li.addEventListener('click', () => {
      const id = li.getAttribute('data-pane') || ''
      const el = document.getElementById(id)
      if (!el) {
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActive(id)
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', '#' + id)
      }
    })
  })

  // Active-section highlight while scrolling (mirrors the mysettings shell).
  function start(): boolean {
    const sections = Array.prototype.slice.call(
      document.querySelectorAll('.instance-stats-section[id]'),
    )
    if (!sections.length) {
      return false
    }
    if (!('IntersectionObserver' in window)) {
      return true
    }
    const io = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort(
            (a, b) =>
              (a.target.compareDocumentPosition(b.target) &
                Node.DOCUMENT_POSITION_FOLLOWING) ===
              Node.DOCUMENT_POSITION_FOLLOWING
                ? 1
                : -1,
          )
        const first = visible[0]
        if (first) {
          setActive((first.target as Element).id)
        }
      },
      { rootMargin: '0px 0px -55% 0px', threshold: 0 },
    )
    sections.forEach(s => io.observe(s))
    return true
  }

  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    if (start() || tries > 50) {
      clearInterval(timer)
    }
  }, 250)
}

async function initInstanceStatsPage(): Promise<void> {
  const root = document.getElementById('instance-stats-root')
  const select = document.getElementById('timeFilter') as
    | HTMLSelectElement
    | null
  if (!root || !select) {
    return
  }

  // Shared DS-nav chrome (golden /admin/site parity).
  renderDsNavChrome({
    navbarRootId: 'instance-stats-navbar-root',
    accountRootId: 'instance-stats-account-root',
    footerRootId: 'instance-stats-footer-root',
    cookieRootId: 'instance-stats-cookie-root',
  })

  void initSettingsPanel(document.getElementById('instance-stats-settings'))
  initAnchorNav()

  // --- charts: render EVERY section (all visible) for the selected window ---
  let requestId = 0
  const renderAll = async (windowKey: WindowKey): Promise<void> => {
    const myRequestId = ++requestId
    const jobs = getSeriesConfig().map(async stat => {
      const series = await fetchSeries(stat.metric, windowKey)
      if (myRequestId !== requestId) {
        return
      }
      await renderChart(stat, series.points)
    })
    await Promise.allSettled(jobs)
  }

  select.addEventListener('change', () => {
    void renderAll(getWindowValue(select))
  })

  // Deep-link (#user / #project / ...) scrolls to that section once present.
  const hash = (window.location.hash || '').replace(/^#/, '')
  if (SECTION_IDS.includes(hash)) {
    const el = document.getElementById(hash)
    if (el) {
      window.setTimeout(() => el.scrollIntoView(), 0)
      setActive(hash)
    }
  } else {
    setActive('user')
  }

  // Delay one tick so the visible sections have layout width before Plotly
  // sizes the containers (no hidden panels to wait for anymore).
  window.setTimeout(() => void renderAll(getWindowValue(select)), 0)
}

void initInstanceStatsPage()
