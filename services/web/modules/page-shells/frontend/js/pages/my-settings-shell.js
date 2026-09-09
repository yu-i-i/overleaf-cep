// /user/mysettings shell behavior (N-2 structural rebuild, 2026-09-01):
// - render the shared React DS-nav chrome (DefaultNavbar INSIDE the page
//   div, the sidebar account dropdown with the shared Theme toggle, the
//   footer + cookie banner) into the shell's mount points — exactly the
//   components / the golden /admin/site uses,
// - sidebar settings-section nav: smooth scroll to the upstream anchor
//   sections (or the text-located "Sessions" h3), active highlight via
//   IntersectionObserver, hidden when the section is absent in this build.
// The static theme radio buttons (and their JS) are gone: theming now
// runs through the shared AccountMenuItems ThemeToggle (same
// ace.overallTheme store / POST /user/settings as /admin/site).
import { renderDsNavChrome } from '../components/ds-nav-chrome'

document.addEventListener('DOMContentLoaded', () => {
  renderDsNavChrome({
    navbarRootId: 'my-settings-navbar-root',
    accountRootId: 'my-settings-account-root',
    footerRootId: 'my-settings-footer-root',
    cookieRootId: 'my-settings-cookie-root',
  })

  const navBtns = () =>
    Array.prototype.slice.call(
      document.querySelectorAll('li.my-settings-nav-item > button')
    )

  function targetOf(btn) {
    const sel = btn.getAttribute('data-target') || ''
    if (sel) {
      const el = document.querySelector(sel)
      if (el) return el
    }
    const text = btn.getAttribute('data-target-text')
    if (text) {
      const hs = document.querySelectorAll('h3')
      for (let i = 0; i < hs.length; i += 1) {
        if ((hs[i].textContent || '').trim() === text) return hs[i]
      }
    }
    return null
  }

  function setActive(btn) {
    // Golden styling lives on `.user-list-filters > li.active > button`, so
    // the active class goes on the LI (not the button).
    navBtns().forEach(b => {
      const li = b.closest('li')
      if (li) li.classList.toggle('active', li === btn.closest('li'))
    })
  }

  navBtns().forEach(btn => {
    btn.addEventListener('click', () => {
      const el = targetOf(btn)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActive(btn)
    })
  })

  // Active-section highlight once the settings app has rendered.
  function start() {
    const btns = navBtns()
    const els = btns.map(targetOf).filter(Boolean)
    if (!els.length) return false

    // Hide nav entries whose section is not rendered in this build
    // (SaaS-gated sections are absent in community editions).
    navBtns().forEach(b => {
      if (!targetOf(b)) {
        const li = b.closest('li')
        if (li) li.style.display = 'none'
      }
    })

    if (!('IntersectionObserver' in window)) return true
    const map = new Map(els.map((el, i) => [el, btns[i]]))
    const io = new IntersectionObserver(entries => {
      const vis = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => ((a.target.compareDocumentPosition(b.target) & 2) ? 1 : -1))
      const btn = map.get(vis[0].target)
      if (btn) setActive(btn)
    }, { rootMargin: '0px 0px -55% 0px', threshold: 0 })
    els.forEach(el => io.observe(el))
    return true
  }

  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    if (start() || tries > 40) clearInterval(timer)
  }, 250)
})
