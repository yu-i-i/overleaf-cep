// /admin/panel shell behavior (N-2 structural rebuild, 2026-09-01):
// - render the shared React DS-nav chrome (DefaultNavbar INSIDE the page
//   div, the sidebar account dropdown with the shared Theme toggle, the
//   footer + cookie banner) into the shell's mount points — exactly the
//   components / the golden /admin/site uses,
// - sidebar tab driving for the upstream bookmarkable tabset anchors
//   (hash deep links keep working: initial hash selects the pane).
// The static theme radio buttons (and their JS) are gone: theming now
// runs through the shared AccountMenuItems ThemeToggle (same
// ace.overallTheme store / POST /user/settings as /admin/site).
import { renderDsNavChrome } from '../components/ds-nav-chrome'

document.addEventListener('DOMContentLoaded', () => {
  renderDsNavChrome({
    navbarRootId: 'admin-panel-navbar-root',
    accountRootId: 'admin-panel-account-root',
    footerRootId: 'admin-panel-footer-root',
    cookieRootId: 'admin-panel-cookie-root',
  })

  const rows = Array.prototype.slice.call(
    document.querySelectorAll('.user-list-filters li[data-pane]')
  )

  function showPane(id, updateHash) {
    const panes = Array.prototype.slice.call(
      document.querySelectorAll('#admin-panel-tabs .tab-pane')
    )
    panes.forEach(p => p.classList.remove('active'))
    const pane = document.getElementById(id)
    if (pane) pane.classList.add('active')
    rows.forEach(li =>
      li.classList.toggle('active', li.getAttribute('data-pane') === id)
    )
    if (updateHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '#' + id)
    }
  }

  rows.forEach(li => {
    li.addEventListener('click', e => {
      const target = e.target && e.target.closest ? e.target.closest('li[data-pane]') : null
      if (target) {
        e.preventDefault()
        showPane(target.getAttribute('data-pane'), true)
      }
    })
  })

  const initial = (window.location.hash || '').replace('#', '')
  showPane(
    initial && document.getElementById(initial) ? initial : 'system-messages',
    false
  )
})
