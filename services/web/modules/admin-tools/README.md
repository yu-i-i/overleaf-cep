# admin-tools

Upstream Overleaf CE module: the admin pages — user management
(`/admin/user`), project lookup (`/admin/project`, gated by
`Settings.features.admin_project_url_lookup`), and the site-admin entry
page (`/admin`). Rendering lives in the core
`Features/ServerAdmin/AdminController.mjs` + `app/views/admin/index.pug`;
the React front-ends under `frontend/js/*` provide the user/project list
UIs (ds-nav sidebars, tables, row actions).

Local fork notes (`bib-editor` branch) — the module code itself is
upstream; the CE+ integration points are:

- **Theming** — `AdminController.index` passes the logged-in user's
  `ace.overallTheme` to the view; `app/views/admin/index.pug` resolves it
  on `DOMContentLoaded` with a CSP-nonced inline script that reads the
  `ol-adminOverallTheme` meta by prefix selector (`name^="ol-admin"` —
  the Views duplicate-meta guard scans for literal `ol-` names, so inline
  scripts must never repeat a meta name verbatim). Admin pages therefore
  follow the user's Dark / Light setting.
- **Branding** — the user-list and project-list sidebars
  (`*ds-nav.tsx`) render the **CE+** mark in the shared lower section.
- **Account menu** — the admin block in the account dropdown (Manage
  Site / Manage Users / Manage Projects / Switch to Admin / Feature
  Flags / Surveys / Script Logs) comes from the shared
  `frontend/js/shared/components/navbar/account-menu-items.tsx`, gated on
  the `ol-navbar` meta flags (`canDisplayAdminMenu`, ...), so the same
  items appear on `/library`, `/templates`, `/project`.
- **Deep-audit finding (informational)** — the ds-nav stylesheets define
  namespaced `--ds-nav-*` custom properties on `body`; they are only
  consumed by the admin-tools page subtree, left as-is (low risk).

## Manage Extensions (SiteSettings admin console, 2026-08-28)

New admin-only page `/admin/site` ("Manage Extensions") + API, backed by the
**core `SiteSettings` feature**
(`app/src/Features/SiteSettings/` — see its README):

- `app/src/SiteSettingsController.mjs`
  - `GET /admin/site` — renders `app/views/manage-site-react.pug`
    (React entry `modules/admin-tools/pages/manage-site`).
  - `GET /admin/site-settings` — all four sections
    (`templates` / `zotero` / `externalUrl` / `signup`), secrets masked
    (`clientSecret` never returned; `clientSecretSet` flag instead),
    plus per-category `Template` counts for the templates section.
  - `PUT /admin/site-settings/:section` — per-section replacement,
    validated by the feature's validators (422 on bad input); an empty
    secret in the payload keeps the stored value.
  - All routes sit behind `AuthorizationMiddleware.ensureUserIsSiteAdmin`.
- `frontend/js/pages/manage-site.tsx` +
  `frontend/js/site-settings/site-settings-root.tsx` +
  `frontend/js/site-settings/components/site-settings-page.tsx`
  - Tabs: **Templates** (gallery switch; category table: name link,
    on/off checkbox, template count, description, Edit modal for
    name+description), **Zotero** (on/off, client key, masked client
    secret — note the shared cipher with GitHub Sync),
    **External URLs** (on/off, blocked CIDR list, allowed-resources
    regex), **Sign Up** (on/off, allowed email domains).
- Nav (user design, 2026-08-28, round 3): a **working “Manage”
  sub-dropdown** (state-driven flyout opening to the *left*; a nested
  react-bootstrap `<Dropdown>` inside the menu is swallowed by the
  parent's root-close handling — broken, user-reported) in the Account
  dropdown: **Manage Site** → `/admin` (the existing System Admin Panel,
  historical name), **Manage Extensions** → `/admin/site`, **Manage
  Users** → `/admin/user`, **Manage Projects** → `/admin/project`. A
  **Projects** entry (→ `/project`) sits above Library. The header
  navbar no longer carries the "Admin" management block
  (`admin-menu.tsx` / `default-navbar.tsx` updated accordingly). Flyout
  style: `frontend/stylesheets/components/dropdown-menu.scss`
  (`.manage-submenu-*`).
