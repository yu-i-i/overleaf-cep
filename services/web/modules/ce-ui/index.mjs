/**
 * ce-ui module (module hygiene, R11-12, 2026-08-30).
 *
 * Home for CE+/fork CSS + UI components that previously lived inside
 * upstream-owned directories (pages/, shared/) and would collide on every
 * upstream merge:
 *
 *   frontend/styles/ce-navbar-consistent.scss  — app navbar theming (round 10-11)
 *   frontend/styles/ce-admin-shells.scss       — /admin/panel + /user/mysettings shells + theme selector
 *   frontend/styles/ce-admin-ui.scss           — CE+ admin card surface (pinned light in both themes)
 *   frontend/js/ds-nav-page-switcher.tsx       — project-list sidebar page switcher (Library/Templates switch)
 *
 * No server-side routes: the files are imported by the host app's stylesheets
 * and components (all.scss, admin.scss, sidebar-ds-nav.tsx), so registration
 * here is documentation + module discovery only. Boot-order-critical code
 * (EnvHydrator) intentionally stays in app/src/Features/SiteSettings (it must
 * run BEFORE the Settings snapshot is taken; see EnvHydrator.mjs header).
 */
// WebModule contract (Modules.mjs): the loader attaches `.name` to the
// module object, so it MUST be a default-exported extensible object —
// an `export {}` namespace is frozen and crash-loops the web boot
// ("Cannot add property name, object is not extensible", caught 2026-08-31).
const CeUiModule = {
  // CSS + React components only — no routes, no sections.
}

export default CeUiModule
