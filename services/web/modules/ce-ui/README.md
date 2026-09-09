# ce-ui — CE+ fork UI module

Fork-owned stylesheets/components moved out of upstream directories to keep
the merge surface minimal (module hygiene, UI round 11 / 2026-08-30).

| File | Loaded by |
|---|---|
| `frontend/styles/ce-navbar-consistent.scss` | `frontend/stylesheets/pages/all.scss` (site-wide) |
| `frontend/styles/ce-admin-shells.scss` | `frontend/stylesheets/pages/all.scss` (site-wide) |
| `frontend/styles/ce-admin-ui.scss` | `frontend/stylesheets/pages/admin/admin.scss` (1-line import) |
| `frontend/js/ds-nav-page-switcher.tsx` | `frontend/js/features/project-list/components/sidebar/sidebar-ds-nav.tsx` |

Deliberately **not** moved here: `EnvHydrator.mjs` (boot-order: must hydrate
environment variables before the Settings snapshot; imported once from
`app.mjs`), and `SiteSettingsManager.mjs` (100% fork-owned new file — no
upstream content to collide with).
