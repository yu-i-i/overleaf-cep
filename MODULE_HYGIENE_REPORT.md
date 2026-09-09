# Module Hygiene Report (R11-12, 2026-08-30)

Goal: minimize the CE+ fork's footprint **outside** `services/web/modules/` so
future upstream merges stay small. Measured with
`git log 92c64b965e..HEAD --name-only` (fork boundary → HEAD).

## After this workstream

- **46 → 51 fork-authored files inside `modules/`** (added: `modules/ce-ui/*` =
  4 UI files + `index.mjs` + `README.md`; `admin-tools/test/unit/src/site-settings.test.mjs`
  moved from `services/web/test/unit/src/`).
- Fork deltas remaining in upstream-owned files: **a documented, minimal list**
  (below). Every other fork-owned file lives in `modules/` or is a 100%-fork
  **new** file inside `app/src/Features/SiteSettings/` (no upstream content to
  collide with).

## What moved (this change set)

| From (upstream dir) | To (fork-owned) | Loaded by |
|---|---|---|
| `frontend/stylesheets/pages/ce-navbar-consistent.scss` | `modules/ce-ui/frontend/styles/ce-navbar-consistent.scss` | `all.scss` (1-line import) |
| `frontend/stylesheets/pages/ce-admin-shells.scss` | `modules/ce-ui/frontend/styles/ce-admin-shells.scss` | `all.scss` (1-line import) |
| CE+ block appended to `frontend/stylesheets/pages/admin/admin.scss` (lines 192–293) | `modules/ce-ui/frontend/styles/ce-admin-ui.scss` | `admin.scss` (1-line import — the entire fork footprint left in that file) |
| `frontend/js/shared/components/sidebar/ds-nav-page-switcher.tsx` | `modules/ce-ui/frontend/js/ds-nav-page-switcher.tsx` | `sidebar-ds-nav.tsx` (relative import) |
| `test/unit/src/site-settings.test.mjs` | `modules/admin-tools/test/unit/src/site-settings.test.mjs` | vitest module tests (25/25 pass from new location) |

`modules/ce-ui` is registered in `config/settings.defaults.js`
(`moduleImportSequence`) for discovery; it is CSS/components-only (no routes).

## Unavoidable upstream touchpoints (documented, do-not-move)

| Upstream file | Fork delta | Why it stays |
|---|---|---|
| `config/settings.defaults.js` | `moduleImportSequence` additions, SSO/site-settings defaults | This IS the fork's module-registration pattern; modules are discovered through it by design. |
| `app.mjs` | +1 line: `import './app/src/Features/SiteSettings/EnvHydrator.mjs'` (boot) | **Boot order**: env hydration must complete BEFORE the Settings snapshot is taken (boot-time readers). Modules load *after* Settings — moving it out breaks the guarantee (EnvHydrator.mjs header documents this). |
| `app/src/Features/SiteSettings/*` (SiteSettingsManager, EnvHydrator, SecretCipher, README) | 100% fork-owned NEW files (P3/R5, `b61b63e7`+) | No upstream content exists here → zero collision surface; the API is the stable boundary the modules use. |
| `app/src/infrastructure/ExpressLocals.mjs` | +view metas (adminOverallTheme, template flags, csrf local, SSO locals, `canManageTemplatesMenu`) | Core view-metadata hook; the fork's contract for its own views + modules' views. |
| `app/src/Features/User/UserPagesController.mjs` | login page merges stored SSO sections (3-line block) + `/user/settings` parity | Settings/login integration point upstream; an alternate "module login-view hook" would be a larger upstream change than the delta saves. |
| `app/views/user/login.pug` | SSO provider buttons under the password form | Markup inside an upstream view; same reasoning as above. |
| `frontend/js/shared/components/navbar/account-menu-items.tsx` | 3 additive deltas: `Account settings` → `/user/mysettings`; "Manage template gallery" item (gated by the template-gallery module's `canManageTemplatesMenu` meta); theme-toggle block | Shared navbar component — the deltas are additive blocks, not upstream-line rewrites (lowest-collision form possible in that file). |
| `frontend/js/shared/components/navbar/default-navbar.tsx`, `admin-menu.tsx` (R10) | minor retargets | same as above. |
| `frontend/extracted-translations.json`, `locales/en.json` | fork i18n keys | Central i18n catalogs; module strings flow through the same files by design. |
| `frontend/stylesheets/pages/all.scss`, `pages/project-list-ds-nav.scss`, `pages/templates-v2.scss`, `components/link.scss`, `pages/admin/admin.scss` | 1–2 import lines / class additions each | Entry-point lines for the module stylesheets; the content itself now lives in `modules/ce-ui`. |
| older-round hooks: `features/file-tree/contexts/file-tree-actionable.tsx`, `app/src/Features/LinkedFiles/*`, `EditorHttpController.mjs`, `ProjectEntityUpdateHandler.mjs`, `models/User.mjs`, `infrastructure/mongodb.mjs`, `frontend/js/vendor/libs/sharejs.js`, `features/ide-react/*` (R5–R7) | integration points with upstream subsystems (linked files, editor, file tree, sharejs) | Each sits at the exact seam upstream exposes; upstream does not offer a module hook for these seams in CE. Revisit per-feature when upstream adds hooks. |

## Merge guidance (next upstream update)

1. `git diff <upstream> --stat -- 'services/web/:!services/web/modules'` — the
   expected surface is the table above (~13 files, mostly ≤5-line deltas).
2. `all.scss` / `admin.scss` / `app.mjs` each carry **1 fork line** — re-apply
   that single line after the merge.
3. Everything under `services/web/modules/` (`admin-tools`, `template-gallery`,
   `bib-editor`, `orcid-picker`, `zotero`, `page-shells`, `ce-ui`,
   `registration-page`, `server-ce-scripts`, `authentication/sso-*`) is
   fork-owned end-to-end — no merge work.
4. If upstream ever adds module hooks for login-view injections or account-menu
   items, migrate the `login.pug` / `account-menu-items.tsx` deltas into
   `modules/ce-ui` (the seam is already shaped for it).
