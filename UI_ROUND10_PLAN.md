> **Historical round log — for current status and open items see `PLAN.md` (single source of truth).**
# UI Round 10 — Implementation Plan (13 items)

Date: 2026-08-30 · Baseline: build deployed to psintern (HEAD `0f3be3f67e`)
All findings below were verified against the **live deployment** today (CDP probes) and against
the source tree. Items 1–13 from the feedback are grouped into 8 workstreams (W1–W8).

---

## 0. Live findings (measured 2026-08-30)

| Page | Nav bg | Nav link color | Note |
|---|---|---|---|
| /project | `rgb(27,34,44)` dark | `rgb(231,233,238)` light | theme-correct, dark |
| /library | `rgb(27,34,44)` dark | `rgb(231,233,238)` light | theme-correct, dark |
| /admin/site | *transparent* over white body | `rgb(27,34,44)` **dark text** | = light/white navbar look — the user's reference |
| /templates/manage | `rgb(255,255,255)` **white** | `rgb(231,233,238)` light | **broken mix** (item 1) |

* Admin Templates tab: category `<thead>` has **5 `<th>` but rows have 6 cells** — the Edit
  column has **no header cell at all** (item 4). (TemplateAdminsTable 3rd column *does* have an empty `<th>`.)
* External URL tab `#ext-net` textarea: computed `color: rgb(27,34,44)` **on** `background: rgb(27,34,44)`
  → text invisible (item 5). Card itself is white.
* E-mail tab: `em-host` top=786, `em-port` top=786, `em-name` top=**803** — 17px drop caused by the
  two-line label "SMTP name/HELO (EMAIL_NAME)" (item 7).
* /library list renders `cardLayout="full"` cards (`library-page.tsx:471`); project panel uses default
  `"compact"`. Library toolbar has an extra "Download" button + bulk download (item 2 scope).
* "Publish as a Template": registered via **build-time macro** (`config/settings.defaults.js`
  `overleafModuleImports.menubarExtraComponents` → `menubar-manage-template.tsx` → command `manage-template`
  + `EditorManageTemplateModalWrapper`). Gate: `getMeta('ol-showTemplatesServerPro') && pdfUrl`.
  Crash `TypeError: c is not iterable` is thrown in the **IDE shared chunk** at click time (item 3).
* Upstream `/admin` = **server-rendered pug** (`app/views/admin/index.pug`, `AdminController.index`,
  bookmarkable tabset: System Messages / Active Projects / Open Sockets / Open-Close Editor), NOT a React
  app. Upstream `/user/settings` = React app (entrypoint `pages/user/settings`, view `user/settings.pug`,
  ~18 meta tags from `UserPagesController.settingsPage`).
* Navbar component on all app pages: same `DefaultNavbar` markup; the /admin/site difference comes from
  the page wrapper `div.user-ds-nav-page website-redesign` scoping light `--navbar-*` variables.

---

## W1 — Navbar unification: /project, /library, /templates/manage → /admin/site look
**Items 8, 9, 10, 11 + the navbar part of item 1. Medium. Highest visual impact.**

Goal: identical navbar (light/white surface, dark text, same height, same item order
`Library · Templates · Projects · Account`) on all four surfaces, **deterministic in both themes**
(light + default), matching the admin-surface convention already used on /admin/site.

Steps:
1. Identify the wrapper producing the /admin/site light navbar: the `div.user-ds-nav-page
   website-redesign` element + the scss that sets `--navbar-bg` transparent and light-theme link colors
   (search `ds-nav` scss; the class is composed in React, likely `useDsNavStyle()`-driven or the
   manage-site page root).
2. Choose mechanism (decide in 1h spike):
   * **A (recommended):** render /project, /library, /templates/manage page content inside the same
     page-chrome wrapper / body class as /admin/site. If the class is React-rendered, the 3 route
     controllers (project list, `LibraryController`, `TemplateGalleryController`) render the same layout
     already; add the wrapper class server-side (pug layout var) so no per-page React change is needed.
   * **B (fallback):** scope the `--navbar-*` variables per route with a dedicated scss block
     (same scoping pattern as `.ce-admin-card` in `admin.scss`) — pin `--navbar-bg: transparent`,
     `--navbar-link-color/--navbar-title-color` to `rgb(27,34,44)`, brand + toggle to the dark palette,
     hover backgrounds to `var(--neutral-10)`. Works even if the wrapper approach proves too invasive
     (e.g., DS-nav sidebar coupling).
3. Remove the hard-coded white navbar background on /templates/manage (item 1 root candidate: a
   `.navbar { background: #fff }`-style rule in the template page scss — `templates-v2.scss` /
   template-admin styles; grep `navbar` in both module scss files) so the page inherits the unified
   variables.
4. Both themes: pin the palette explicitly (do not rely on theme variables) so light and default themes
   render identically — same rule we used for `.ce-admin-card` (deterministic in both themes).
5. Regression: IDE/editor chrome must be untouched (editor toolbar/file-tree keep their theme colors);
   account menu + DS-nav page-switcher still work on all 3 pages.

Verify: CDP probe per page (nav bg, link color, brand color, height 68px, item order) in **both** themes;
screenshots side by side with /admin/site.

---

## W2 — /templates/manage theme awareness
**Item 1. Small (largely covered by W1).**

1. After W1, audit the whole page (body text, category cards, tables, modals) for hard-coded
   light/dark values ignoring `body[data-theme]` — same computed-style probe method as the admin tabs.
2. Apply the same scoping rule: page content sits on a white surface with the pinned dark palette
   (label `rgb(27,34,44)`, hint `rgb(73,83,101)`), identical in both themes.
3. Verify in light + default theme; confirm the page-switcher (Library/Templates/Projects) still renders
   (it uses `--ds-nav-*` variables — check both).

---

## W3 — /library → project reference-panel parity (+ drop the extra Download)
**Item 2. Small — the components are already shared.**

Findings: `BibEntryList`/`BibEntryPreview` are the same components; the library already has the search
box and Add dropdown. Only deltas:
1. `library-page.tsx:471` → `cardLayout="full"` → change to `"compact"` (project default). Keep the
   trash view consistent (check `variant="trash"` path — use compact there too for parity).
2. Remove the library-only Download affordances the user flagged as "the extra Download button":
   toolbar `library-download-all-btn` (download-all) and the bulk-download button in empty state, and the
   per-entry Download in the preview's `more_vert` menu **if the project panel does not have it** (the
   project's `BibEntryPreview` `onDownload` prop is passed by `bib-editor-panel.tsx`; compare and make
   the library match the project exactly). Library keeps: search, Add (paste/manual/ORCID/Zotero where
   available), select/bulk-delete, trashed view, import modal.
3. Keep all working flows (verified today: split resizer + collapse/expand + persistence).

Verify: class-list diff between project panel and library list (card class names, buttons present/absent);
functional regression of the 9-check split battery on /library.

---

## W4 — Fix "Publish as a Template"
**Item 3. Medium (debug-first).**

Findings: File-menu item comes from the build-time macro
`overleafModuleImports.menubarExtraComponents` → `menubar-manage-template.tsx`; the crash is in the IDE
shared chunk at click time; the gate meta `ol-showTemplatesServerPro` is **not set anywhere in
ExpressLocals** (grep returns nothing), so `publishAsTemplateEnabled` is falsy and the command is
`disabled` — yet the menu still renders it and something on click/render crashes with "c is not
iterable".

Steps:
1. **Repro + pinpoint**: CDP on a compiled project — open File menu, click "Publish as a Template",
   capture the console error + error-boundary text; map minified offset `ide-*.js:1:271260` through the
   source map to the exact function (candidates: `CommandDropdown` section iteration at
   `command-dropdown.tsx:178` (`...command`), `menu-bar.tsx:351` `menubarExtraComponents.map`, or an
   `OLModal`/`OLForm`/`useFocusTrap` iteration in the shared chunk).
2. Decide + fix (in order of likelihood):
   a. The `manage-template` command object is missing the shape `CommandDropdown` expects
      (sections/items) → crash iterating `section.items` → either fix the registration shape or (better)
      render "Publish as a Template" as a plain `MenuBarOption` inside the File dropdown (upstream
      pattern) and drop the command-provider registration.
   b. If the real crash is in a shared component → add a guard there (no upstream-behavior change).
3. **Enable it properly**: set/verify `ol-showTemplatesServerPro` meta in the editor page locals
   (ExpressLocals) so the gate works; require `pdfUrl` (a compile must exist) — with a clear disabled
   state + tooltip when not compiled (no crash path).
4. End-to-end: publish from a compiled project → `POST /template/new/:projectId` → template appears in
   `/templates/<cat>` gallery and in the Templates admin tab's per-category counts; 409 title-conflict →
   overwrite flow; non-admin user cannot publish (category `publishable` false) — negative test.

Verify: CDP click-through incl. modal renders; gallery listing; counts; error path (no compile → item
disabled, no console crash).

---

## W5 — Templates admin tab: Edit column header
**Item 4. XS.**

Root cause (measured): category table thead has 5 `<th>` (Name/Status/Publishable/Templates/Description)
but each row has **6 cells** (Edit action is the 6th) → the 6th column has no header cell, so the header
strip above "Edit" is not a `<th>` and shows a different background.

Fix: add the missing 6th `<th>` in `TemplatesTab` (empty text, right-aligned, keep the th background like
its siblings). One-line change; run the tab-render + import audit; rebuild.

Verify: `thead th count == tbody td count` in DOM; screenshot.

---

## W6 — External URL tab: readable textarea
**Item 5. XS.**

Root cause (measured): `#ext-net` textarea computed `color: rgb(27,34,44)` on
`background-color: rgb(27,34,44)` (dark-on-dark; the card is white) — the card scoping pinned label text
but not the form-control surface; the `color-scheme: dark` UA styling on the textarea resolves the
background to a dark value.

Fix in `admin.scss` `.ce-admin-card` scope: explicitly pin
`input.form-control, select.form-control, textarea.form-control { background: var(--white); color:
rgb(27,34,44); border-color: var(--neutral-30) }` (+ placeholder color) — deterministic in both themes.
Then **audit all 13 tabs** with the computed-style probe (every input/select/textarea: color, bg,
placeholder) in both themes so this class of bug is closed everywhere (Zotero password field, sign-up
fields, e-mail fields, etc.).

Verify: probe table (per control: color/bg/contrast ratio ≥ 4.5:1) in light + default theme; screenshot.

---

## W7 — E-mail tab: test-send block + label alignment
**Items 6 + 7. Medium (new endpoint + UI).**

### 7 (alignment, XS)
Root cause (measured): `em-name` input sits 17px lower — its label wraps to two lines
("SMTP name/HELO (EMAIL_NAME)"). Fix: one-line label **"SMTP name (EHLO)"** + `form-text` hint
"Sent as `EMAIL_NAME`" — matches the CE+ vocabulary (strong label, env var as hint, as on the other
tabs where the parenthetical fits one line).

### 6 (test e-mail, M)
UI (same tab, new section card "Send a test e-mail"):
* `Field` — "To address" (`type=email`, required).
* `Button btn-primary` — "Send test e-mail" (disabled while sending; loading text "Sending…").
* Inline result: green Notification "Test e-mail sent to <addr>" or red Notification with a sanitized
  error (no credentials, no raw SMTP dumps).

Backend (admin-tools module, new route `POST /admin/site-settings/email/test`):
1. `AuthorizationMiddleware.ensureUserIsSiteAdmin` + CSRF.
2. Load stored E-mail section via `SiteSettingsManager.getSection('email')`; decrypt host/credentials
   per existing `SecretCipher` usage (same path the hydrator uses).
3. Send using the **same mailer code path** as production notifications — locate the existing mailer
   (CE `node-mailer` wrapper around the app settings) during implementation; construct a one-off
   transport from the stored config (host/port/secure/credentials/name + `from` = configured sender).
4. Subject: `[Overleaf] SMTP configuration test`, small HTML+text body (sent-from, timestamp, host).
5. Guards: `to` must be a valid e-mail address; **admin-only route** (no open relay); rate-limit
   ~5/min per admin (in-memory token bucket); timeout ~15s; errors sanitized.
6. Unit tests: handler with mocked mailer (success / SMTP auth failure / malformed address), rate limit.

Verify: CDP — fill `testjoe@rotermund.at`, click, 200 + success notification; confirm delivery (mailbox)
or SMTP log in container; negative: bad address → 422, no mail.

---

## W8 — Embed upstream pages in our shell without touching upstream code
**Items 12 + 13. Large. Two similar shells.**

### New module: `services/web/modules/page-shells/`
Per user direction (2026-08-30): **ALL new code for `/admin/panel` and `/user/mysettings` lives in ONE
NEW MODULE** under `modules/`, separate from upstream code (upstream `app/src/Features/Admin`,
`app/src/Features/User`, `app/views/admin`, `app/views/user` stay byte-identical). Both shells share
the module; the module structure follows the existing fork modules (admin-tools / bib-editor /
orcid-picker):

```
modules/page-shells/
├── index.mjs                                # exports { router } (+ Settings hooks if needed)
├── README.md                                # purpose, upstream-upgrade safety, option A/B notes
├── app/
│   ├── src/
│   │   ├── PageShellsRouter.mjs             # GET /admin/panel (siteAdmin) , GET /user/mysettings (auth)
│   │   ├── AdminPanelController.mjs         # /admin/panel handler (imports upstream AdminController data logic; no upstream edits)
│   │   ├── MySettingsController.mjs         # /user/mysettings handler (imports upstream settingsPage locals logic)
│   │   └── ShellAuth.mjs                    # shared authorization helpers (siteAdmin vs loggedIn) — thin wrappers
│   └── views/
│       ├── admin-panel.pug                  # shell A: upstream tabset content (mixin/partial includes) in CE+ surface
│       └── user-my-settings.pug             # shell B: extends layout-react, entrypoint 'pages/user/settings' (upstream JS entry, untouched)
└── test/
    └── unit/src/
        ├── admin-panel.test.mjs             # auth, 200, locals presence, no upstream-file diff
        └── my-settings.test.mjs             # auth, 200, meta-tag parity with /user/settings
```

Registration (the ONLY upstream-file touch, and it follows the fork's own established pattern — the same
list already contains `orcid-picker`, `bib-editor`, `template-gallery`, …): one line in
`config/settings.defaults.js` → `moduleImportSequence`: `'page-shells'` (after `'admin-tools'` so the
authentication module loads first, same as registration-page). No other upstream file is edited.

Rules:
* The module **imports** upstream code (controller functions, pug mixins/partials, JS entrypoints) — it
  never edits it.
* New front-end needs are inside the module `frontend/` only (likely zero JS for admin-panel; the
  mysettings shell renders the upstream `pages/user/settings` entrypoint — no new entrypoint required).
* All new scss for the shells goes into existing per-page scss includes via our scopes (or a module
  stylesheets file referenced by the module views) — never into upstream scss.

### 12 — `GET /admin/panel` (upstream Admin panel in CE+ shell)
Findings: upstream `/admin` is **server-rendered pug** (`app/views/admin/index.pug`) with a bookmarkable
tabset (System Messages, Active Projects, Open Sockets, Open/Close Editor) + SaaS tabs; its forms POST to
stable upstream endpoints (`/admin/messages`, `/admin/closeEditor`, …); it already has its own theming
script (`ol-adminOverallTheme` meta → `body[data-theme]`).

Options (spike 2h, decide) — both fully inside `modules/page-shells/`:
* **A — server-side include (recommended if clean):** `AdminPanelController` re-uses the upstream
  `AdminController.index` data collection (import it from `app/src/Features/Admin`, don't modify it),
  renders the module's own `app/views/admin-panel.pug` that reuses the upstream mixin
  (`bookmarkable_tabset`) and the upstream partials (`active-projects.pug` is already included
  cross-module elsewhere) inside our CE+ card surface + W1 navbar. Upstream endpoints unchanged →
  forms keep working. Zero upstream diff beyond the module registration line.
* **B — same-origin iframe fallback:** module view `admin-panel.pug` embedding `<iframe src="/admin">`.
  Zero duplication, zero upstream changes; trade-offs: nested scrollbar, double nav (mitigate: shell
  omits its nav bar and the iframe's app-navbar becomes the top — still consistent with app pages),
  theme isolated per body. Use only if A is not clean by spike time.

Common to both:
* **Re-target the Account menu (lower-left user menu) links** — both are OUR code in
  `frontend/js/shared/components/navbar/account-menu-items.tsx` (no upstream involvement, safe to edit):
  - `ManageMenu` list (line ~27): `{ href: '/admin', label: 'Manage Site' }` → **`{ href: '/admin/panel',
    label: 'Manage Site' }`** — the shell for the upstream Admin panel is now at /admin/panel.
  - `NavDropdownLinkItem href="/user/settings"` (line ~120, "Account settings") → **`href="/user/mysettings"`**.
  - Keep `{ href: '/admin/site', label: 'Manage Extensions' }`, `'/admin/user'`, `'/admin/project'` unchanged.
  - Upstream `/admin` and `/user/settings` remain fully functional (deep links, existing muscle memory);
    the menu just points at the CE+ shells.
* Route + admin auth in `AdminToolsRouter`; upstream `/admin` stays as-is (upgrade-safe, works for deep
  links).
* i18n keys (manual, both locale files).
* Theme verification via the Account-menu theme switcher (Dark `''` / Light `'light-'` / System
  `'system'` radios) — the W1/W2 probes must cover all three values.
* Feature-matrix test (CDP): every tab's action (post/clear message, active-projects table, sockets
  list, close/open editor, SaaS tabs) — before/after.

### 13 — `GET /user/mysettings` (upstream account settings in CE+ shell)
Findings: upstream `/user/settings` is a **React app** (entrypoint `pages/user/settings`) whose view
(`user/settings.pug`) needs ~18 meta tags computed by `UserPagesController.settingsPage` (user,
hasPassword, oauthProviders, samlError, passwordStrengthOptions, thirdPartyIds, …).

Options (spike 2h, decide — same pattern as 12, same module) — all new files under
`modules/page-shells/`:
* **A — import upstream, render in shell (recommended):** module route `GET /user/mysettings`;
  `MySettingsController` **calls the upstream `settingsPage` locals logic** (import the needed helpers;
  or literally `await settingsPage(req, res)` after stubbing `res.render` to capture locals — decided
  in spike), then `res.render('page-shells:user-my-settings', locals)` where the module view
  `user-my-settings.pug` extends `layout-react` with the **same entrypoint** (`pages/user/settings`) +
  the same meta block, wrapped in our CE+ chrome. Upstream files untouched; the React app initializes
  exactly as on /user/settings.
* **B — iframe fallback** (`<iframe src="/user/settings">`), same trade-offs as 12.

Common: account-menu item "Account settings" → `/user/mysettings` (see the exact line in the W8-common
list above); keep `/user/settings` untouched;
i18n; CDP feature matrix (profile edit, password change, SSO disconnect display, sessions, API tokens,
theme toggle) for both shells; **upgrade-safety check**: apply a representative upstream patch to one
touched-adjacent upstream file and re-run the matrix (proves we didn't fork behavior).

---

## Cross-cutting rules (apply to every workstream)

1. **Theme discipline** — every new/changed surface must pass a two-theme (default + light)
   computed-contrast probe (text/bg ≥ 4.5:1) or be pinned to the deterministic light palette (same as
   `.ce-admin-card`). Nav work (W1) uses the DS-nav variable scoping or the pinned-palette fallback.
2. **i18n** — add keys manually to BOTH `frontend/extracted-translations.json` and `locales/en.json`
   (scanner regeneration is lossy — known issue); verify with grep.
3. **Imports/audit** — this repo's eslint does **not** catch missing-import/missing-export or undefined
   identifiers: after every cross-file front-end edit, run the import/export grep audit (see failure
   memory: TextArea, useCallback incidents).
4. **Deploy** — `make all` → `cycle_overleafserver.sh` → healthy → IMAGE_MATCH → run the item's CDP
   verification; commit with precise messages; keep BUGHUNT_REPORT.md up to date at the end.
5. **No upstream behavior changes** in W4/W8 where avoidable (guard-level fixes only). W8's only
   upstream-file contact is the single `moduleImportSequence` registration line (the fork's standard
   module-registration pattern); the `/admin` and `/user/settings` upstream files stay byte-identical —
   assert this in each shell's unit test (`git diff --stat` on the upstream paths must be empty).

## Sequencing & sizing

| # | Workstream | Items | Size | Depends |
|---|---|---|---|---|
| 1 | W5 Templates tab header | 4 | XS | — |
| 2 | W6 External URL textarea + 13-tab contrast audit | 5 | S | — |
| 3 | W7a e-mail label | 7 | XS | — |
| 4 | W1+W2 navbar unification + /templates/manage theme | 1,8,9,10,11 | M | — |
| 5 | W3 library parity − Download | 2 | S | — |
| 6 | W7b test e-mail | 6 | M | — |
| 7 | W4 publish-as-template | 3 | M | — |
| 8 | W8a /admin/panel shell | 12 | L | spike |
| 9 | W8b /user/mysettings shell | 13 | L | spike (parallel with 8) |

Suggested order: 1→2→3 (quick wins in one build), 4 (the big visual item), 5, 6, 7, then 8+9 in
parallel spikes → implementation. Each step ends with build + the item's verification; one PR-sized
commit group per workstream.

## Top risks

* W1: DS-nav coupling — `/project` already renders the DS-nav page-switcher; changing the chrome scope
  may affect the switcher or account menu → keep the spike to 1h, fall back to variable scoping (B).
* W4: the crash may sit in shared `OL*` components → fix must be a guard, not a behavior change; also
  `ol-showTemplatesServerPro` currently unset → item may be *disabled* (not merely broken) — both need
  the repro before touching code.
* W8: "import upstream unchanged" vs. feature parity on a React app (W8b) is the hardest constraint —
  the spike exists precisely to fail fast; the iframe fallback is acceptable for an admin-internal
  surface.
* Theming: pinning palettes diverges from upstream theming on future updates — mitigation: all pins live
  in our own scss scopes (`.ce-admin-card`, new navbar scope), none in upstream files.

---

## Implementation results (2026-08-30 — ALL 13 ITEMS DONE, deployed, verified)

Deployed build 33 (`28751cdb0cf6`), pushed HEAD `dbb076a1ca` (branch `bib-editor`).
Commits: `f7d94de483` (W3/W5/W6/W7a) → `7095f7756f` (W1/W4/W7b) → `4fc0d84bea` (W8 + menu) → `dbb076a1ca` (tests + SES guard).

| Item | Result | Verification |
| --- | --- | --- |
| 1 navbar unification | `ce-navbar-consistent.scss` (imported by `all.scss`) re-applies `navbar-light` + red gradient on `#project-list-root/#library-root/#template-root/#template-gallery-root` at /admin/site parity | /project, /library, /templates, /templates/manage all white surface + dark text in Dark **and** Light |
| 2 library parity | `library-page.tsx`: compact cards (default layout), library-only Download-all + per-bulk Download removed; project-panel split behavior untouched (9/9 previously) | /library probe: 18 entries, `downloadAll: false`, `downloadBtns: 0` |
| 3 publish-as-template | **Root cause**: `settings-template-category.tsx` — `options.find(...) ?? (value?[...]:[])` returns a single Option object when the value matches a known category; `[...current]` throws `TypeError: c is not iterable` | Modal opens clean, no JS errors, publish + overwrite flow completed, template visible in /templates gallery |
| 4 test e-mail | `POST /admin/site-settings/email/test` (admin-only, 5/min, sanitized, stores-config transport) + UI block in E-mail tab; SES legacy-transport guarded (newer nodemailer rejects it → clean error) | UI click → "Test e-mail sent to — testjoe@rotermund.at"; API `200 {"ok":true}`; unit tests pass |
| 5 table headers | 6th `<th aria-label="Edit category">` added | Templates tab: `6 th | 6 td` |
| 6 textareas/inputs | `.ce-admin-card` form controls pinned to light surface in both themes (admin.scss) | External-URLs textarea: `color rgb(27,34,44) / bg rgb(255,255,255)` |
| 7 email label | "SMTP name (EHLO)" + `EMAIL_NAME` moved to hint | verified in DOM |
| 8 /admin/panel | **page-shells module** (new): `captureRender` imports upstream `AdminController.index` locals; 1:1 pug mirror; registered in `moduleImportSequence`; zero upstream edits | renders with tab set + upstream `/admin/*` actions; /admin still 200 |
| 9 /user/mysettings | same module: `captureRender` of upstream `UserPagesController.settingsPage`; 1:1 mirror of `user/settings.pug` (entrypoint `pages/user/settings`) | `#settings-page-root` React app mounts ("Account settings…Update account info…"); /user/settings unchanged |
| 10–13 | covered by W7b (10/11), W8 menu retarget (12: Manage Site→/admin/panel, Account settings→/user/mysettings), SSO regressions (13: SAML → /project green) | live probes above |

Unit tests: `page-shells.test.mjs` (7) + `email-test.test.mjs` (6) pass; eslint `--max-warnings 0` clean on all touched files. Core `test/unit` suite: 220 pre-existing env/mock failures (redis/sandbox — present before this round; unrelated modules), 5073 pass.
