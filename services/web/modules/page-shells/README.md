# page-shells (CE+ fork module)

**UI-R10 W8, 2026-08-30.** Same-origin, themed wrappers for two upstream
pages, so the fork's account menu can use bookmarkable, light-themed
addresses without ever editing upstream code:

| Shell URL          | Upstream page wrapped                | Upstream handler (imported, unmodified)                              |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| `GET /admin/panel` | `GET /admin` (admin tabset, pug)     | `app/src/Features/ServerAdmin/AdminController.mjs` → `index`        |
| `GET /user/mysettings` | `GET /user/settings` (React app) | `app/src/Features/User/UserPagesController.mjs` → `settingsPage`    |

## How it works ("import, don't edit")

1. **`captureRender`** runs the upstream handler against a fake `res`.
   The handler's full behavior executes unmodified (session message
   consumption, split-test assignment, SaaS conditionals, …) — we only
   intercept the final `res.render(view, locals)` to capture the exact
   local variables, or a `res.redirect` (user-deleted / not-logged-in).
2. The shell controllers then render **this module's own pug view** with
   those locals:
   - `app/views/admin-panel.pug` — a 1:1 mirror of
     `app/views/admin/index.pug` (same bookmarkable tab set, same forms
     POSTing to the unchanged `/admin/*` endpoints, same
     `active-projects` partial, same theme meta + script).
   - `app/views/user-my-settings.pug` — a 1:1 mirror of
     `app/views/user/settings.pug` (same `pages/user/settings` React
     entrypoint, same `ol-*` meta tags, same `#settings-page-root`).
3. The upstream pages keep working on their original URLs — the shells
   are additive. The account menu (`account-menu-items.tsx`) points at
   the shells.

## Hard constraint

NO upstream file is edited by this feature. Upstream files are imported
(handlers, mixins, partials, React entrypoints). `test/unit/src/page-shells.test.mjs`
asserts the mirror surfaces (tabs, actions, meta names, entrypoint) and
that the controllers import the upstream handlers.

## Registration

`'page-shells'` is appended to `config/settings.defaults.js`
`moduleImportSequence` (the fork's own registration pattern — same as
`orcid-picker` / `bib-editor`).

## Verification (2026-08-30, build 31)

- `npm run test:module` (page-shells unit tests) — pass.
- Browser: both shells render in Dark + Light (system) with the app
  navbar; `#settings-page-root` React app mounts on `/user/mysettings`;
  `/admin/panel` tab set + system-messages form work; upstream
  `/admin` and `/user/settings` unchanged.
