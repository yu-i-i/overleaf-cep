> **Historical round log — for current status and open items see `PLAN.md` (single source of truth).**
# UI Round 11 — dark-mode polish, account-settings/admin-panel shells, template-admin fixes

**Context:** user reports 14 issues while viewing **dark mode** (2026-08-30). Baseline: build 33 (`28751cdb0cf6`), HEAD `021c7abfef` on `bib-editor`.
**Grounding:** every item below was checked against the live site (CDP, dark mode) and/or the current source before planning.

---

## Verified root causes (from this session's recon)

| # | Item | Measured/grounded finding |
|---|------|---------------------------|
| 13 | pale input values (Sandboxed compiles / E-mail / Pandoc) | **Proven:** in dark mode `#em-from`, `#sc-hostdir`, `#pd-image` compute to **value-text `rgb(244,245,246)` on background `rgb(255,255,255)`** → light-on-white = unreadable. Cause: the W6 pin `.ce-admin-card .form-control { color: rgb(27,34,44) }` in `frontend/stylesheets/pages/admin/admin.scss` has **no `!important`** and is overridden by the dark-theme rule (labels are fine because they use `!important`). Also `.ce-admin-card` itself computes to the theme grey `rgb(244,245,246)` — not pinned white. |
| 2,3 | Account button on /project + /library | **Proven:** `nav-item-account` present on both navbars (items: Library / Templates / Projects / Account). Source: `frontend/js/shared/components/navbar/logged-in-items.tsx` (renders `AccountMenuItems` in a `NavDropdown`, class `nav-item-account`). Desired state per user: only the 3 links. |
| 6,7,8 | navbar white→red gradient on /project, /library, /templates | The W1 `ce-navbar-consistent.scss` re-applies the red-gradient tail on `#project-list-root`, `#library-root`, `#template-root`, `#template-gallery-root`. Remove gradient; keep solid neutral white surface + dark nav-link text (both themes). |
| 4 | /library card CSS broken | **Proven:** library card computes to `bg transparent, color rgb(244,245,246)` (dark-theme text, no card surface). Cause: card styles are **duplicated and page-scoped, diverged**: `.bib-editor-panel .bibtex-entry-card` (`bib-editor-panel.css:695`) vs `.library-page-main .bibtex-entry-card` (`bib-library.css:640`). |
| 5 | separator/update-algorithm parity | Both pages already render the shared `SplitResizer` via the shared `BibEntryPreview` (`resizerStorageKey="libraryResizer"` vs `"bibPanelResizer"`) — the difference is in container scoping / clamp / update path around it. Project reference: `.bibtex-preview-resizer` (aria min 25 / max 75 / live `--bibtex-split-preview-width`). |
| 9 | bundles table lacks Edit/Delete | Confirmed: `template-bundles.tsx` row (lines ~179–194) renders only "Download bundle". |
| 10 | bundle import 500 `templateId` | **Repro (same flow):** import returns `409 {"canOverride":true,...}` when the name exists — handled fine. The user's 500 came from the minified **`5657-*.js` chunk**, i.e. *outside* the template-admin bundle → the failing code path was not re-traced. Plan: instrument the live UI (PerformanceObserver + fetch hook) to capture the exact request/response, then fix at the origin (client error-path + a server-side null-guard in `_importValidatedBundle`/related helpers so "re-import after delete" can never 500). Manager code path inspected: `_importValidatedBundle` already null-guards `existing` — the crash is in an adjacent call (or the client's override flow after 409). |
| 12 | missing other admin in Templates→Gallery admins | **Root cause found (high confidence):** `UserListController.templateAdmins` queries **only** `User.find({'flags.canManageTemplates': true})`. Our other admin (testjoe) is a **site admin via `isAdmin: true`** — a top-level field, not a flag (the UI row even reports `"isAdmin": false` for him). Users granted the template flag through the Create/Update-account modal (which writes `flags.canManageTemplates`) are missing if they're site admins / flag-less. Fix: union query `{$or: [{ 'flags.canManageTemplates': true }, { isAdmin: true }]}` (de-dupe). |
| 1 | /user/mysettings shell | Upstream settings app exposes stable section anchors: `#update-account-info` (h3), password form `#password-change-form`, `#project-sync` (h3), `#references` (h3) inside `linking-section.tsx`; "Linked accounts" + "Sessions" headings need their ids located (same file / `sessions-section.tsx`). The app is a single scroll container (`settings-page-root` → `OLPageContentCard`) → shell nav = anchors + active-state observer, **no upstream edits**. |
| 11 | /admin/panel shell | `/admin/panel` is our `page-shells` module (view mirrors `app/views/admin/index.pug`) — restyle surface is fully ours; upstream endpoints stay. |

---

## Workstreams

### R11-1 — dark-mode contrast pin (item 13) — **S**
1. `admin.scss`: in `.ce-admin-card`, pin the **card surface** itself to white (`background-color: #fff !important` in both themes) and add `!important` to the `.form-control, .form-select, textarea` **color** (`rgb(27,34,44)`) + placeholder (`rgb(141,150,165)` stays). Keep `color-scheme: light`.
2. Also pin `.form-check-input`, `.btn` focus rings inside the card if any theme override leaks (spot check).
3. **Verify (dark + light):** CDP-computed `color`/`backgroundColor` for `#em-from`, `#em-host`, `#em-user`, `#sc-hostdir`, `#sc-flags`, `#pd-image`, `#pd-flags`, **all 13 admin tabs** (loop the sidebar buttons), assert text-on-surface contrast ≥ ~7:1.

### R11-2 — neutral navbars (items 6, 7, 8) — **S**
**Intent (item 15 clarification):** the white→red gradient is an **"admin page" warning signal** — it belongs on admin consoles and must NOT appear on normal user pages. Scope accordingly:
- **Remove** the gradient from `/project`, `/library`, `/templates` (user pages).
- **Keep** it on the admin surfaces: `/admin`, `/admin/site`, `/admin/panel` and `/templates/manage` (template-management console — admin role required).
1. `ce-navbar-consistent.scss`: drop the red-gradient (white→red) rules for `#project-list-root`, `#library-root`, `#template-root`; keep the rule for `#template-admin-root` (admin console). User-page bars get a **solid neutral** surface: `background-color: #fff` (both themes) + keep `navbar-light` so nav-link text stays `rgb(27,34,44)`.
2. **Verify:** computed `background-color` + first nav-link color on /project, /library, /templates (both themes) = white bar + dark text **and no `backgroundImage: gradient`**; /templates/manage + /admin/site + /admin/panel **still show the red gradient**; brand logo visible (already switches via `--navbar-brand-image-default-url` — confirm no inversion artifact).

### R11-3 — remove Account nav item on /project + /library (items 2, 3) — **S**
1. In `logged-in-items.tsx` (the `NavDropdown` with `nav-item-account`), render the Account item **conditionally**: off on the project-list page and the library page, on elsewhere (/templates keeps it — that's the user's desired DOM). Route detection: existing page flag/meta or the root-class check (`#project-list-root`, `#library-root`) — prefer an explicit prop from the two page roots (project-list DS nav + library navbar usage) so it stays declarative.
2. **Note (acceptance):** this removes the top-nav entry to theme-switcher / logout from /project and /library; the account menu remains reachable on /templates and the login page. If the user later wants those on the sidebar, that's a follow-up (not included here).
3. **Verify:** navbar on /project + /library contains **exactly** `Library / Templates / Projects` (dark + light); /templates still shows the Account button; account menu still opens on /templates.

### R11-4 — library card parity (item 4) — **M**
1. Extract the card surface rules into one **shared** rule `.bibtex-entry-card` (background, border, radius, text colors, key/title/author/year typography, hover/selected/error states) — single source of truth.
2. `.bib-editor-panel .bibtex-entry-card` and `.library-page-main .bibtex-entry-card` become page-specific overrides only (padding differences if any).
3. Delete the divergent library copy in `bib-library.css:640` that leaves the card transparent.
4. **Verify (dark + light):** computed `.bibtex-entry-card` bg/border/`keyColor` **identical** on /library and /project (with the bib panel open); selection + error-icon states intact; bulk-select checkbox behavior unchanged.

### R11-5 — resizer parity (item 5) — **M**
1. Diff the two `BibEntryPreview` integrations (`library-page.tsx:~503` vs `bib-editor-panel.tsx:~650`): clamp range, storage keys, the element that receives `--bibtex-split-preview-width`, and the drag update path.
2. Unify so **both** pages: same 25–75 clamp, same `aria-*`, **live** width update during drag (pointermove → CSS var on the shared split container), same collapse/expand + persistence; keep the proven 9/9 split behavior.
3. **Verify (CDP pointer-drag on both pages, dark + light):** mid-drag `--bibtex-split-preview-width` changes; `aria-valuenow` tracks; state persists across entry switches; collapse → list hidden, preview full-width; library no longer lags/behaves differently.

### R11-6 — template bundles: per-row Edit + Delete (item 9) — **M**
1. `template-bundles.tsx` row actions: add **Edit** (opens the existing template-edit flow — same form the "Edit" button uses in the gallery admin: name / category / version / description; reuse the existing modal/wrapper, prefill from the bundle's template) and **Delete** (confirm dialog → existing `DELETE` template endpoint for admins; template-admins get it only if they can manage — reuse `ensureTemplateManagementAccess` semantics).
2. i18n keys (EN both locale files), button variants (`btn-sm btn-ghost` Edit / `btn-sm btn-danger-ghost` Delete) consistent with the CE+ vocabulary.
3. **Verify:** edit a bundled template (name/category change persists after Save; version bumps once); delete a test template (row disappears; gallery 404s for it; SSO users unaffected); non-admin sees no new destructive buttons.

### R11-7 — bundle import crash fix (item 10) — **M (diagnose) + S (fix)**
1. Instrument the live UI (CDP: wrap `fetch` in-page + `PerformanceObserver` on resource entries) and replay the user's exact flow: *download bundle → delete template on site → Import from file* — capture the exact failing URL / status / payload / `templateId` read (which chunk + de-stack via source map if needed).
2. Fix at origin: client error path (the `5657-*.js` handler around the import/override flow) to send/handle the correct shape; server: harden `_importValidatedBundle` + `importTemplateBundle` helpers against any undefined-template path (defensive `?.` + clean 4xx), keeping the 409-conflict and 422-issues contracts.
3. Add unit tests: import with **no** existing template (create), with existing + override, with existing without override (409), and the re-import-after-delete sequence (via manager with mocked Template model).
4. **Verify:** the exact user flow succeeds (template restored, version correct, owner = importing admin); unit tests green.

### R11-8 — gallery-admins list completeness (item 12) — **S**
1. `UserListController.templateAdmins` (admin-tools): union query `User.find({ $or: [{ 'flags.canManageTemplates': true }, { isAdmin: true }] })`; mark each row with its source; the **Revoke** button only for flag-based admins (revoke of a site admin is not a template-role revoke).
2. Re-verify `TemplateAuthorizationHelper.hasTemplateAdminAccess` treats the two classes consistently for `/template/*` routes (read path only).
3. **Verify:** list shows testjoe **and** any flag-granted admins; revoke a flag admin (row disappears, its access drops); site admin rows stay without a (dangerous) Revoke.

### R11-9 — /user/mysettings CE+ shell (item 1) — **L**
1. `page-shells` module: new `user-my-settings-shell` layout for `/user/mysettings`:
   - **Header** in the `/admin/site` vocabulary (title "Account settings", subtitle with signed-in e-mail) — `ce-admin-ui`-style markup + `admin.scss` tokens (the R11-1 pin applies here automatically).
   - **Left nav** (the 6 items, exact labels from the user): *Update account info* / *Change password* / *Project synchronisation* / *Reference managers* / *Linked accounts* / *Sessions*.
   - Each item = an **anchor scroll** to the upstream section (ids found so far: `#update-account-info`, `#password-change-form` (heading id to be confirmed), `#project-sync`, `#references`; Linked accounts + Sessions heading ids to be located in `linking-section.tsx` / `sessions-section.tsx` — add a stable `id` via a **CSS/JS probe at runtime only if none exists** (no upstream edits); fallback: anchor by heading text via a small in-shell script).
   - Active-state highlighting while scrolling (IntersectionObserver), hash updates (`#update-account-info` …) so sections are bookmarkable.
   - One React app instance stays mounted (no re-mount on nav click); scroll offset accounts for the header.
2. Keep `/user/settings` fully functional (shell is additive; upstream untouched — unit-test assertion unchanged + a new mirror test for the 6 nav ids).
3. **Verify (dark + light):** 6 nav items present and scroll to the right section (DOM heading text match), active highlight follows scroll, hash round-trips, all 6 sections still fully interactive (password change, session list, sync settings), and the page's meta/local surfaces are identical to upstream (snapshot diff of `ol-*` metas).

### R11-10 — /admin/panel CE+ shell (item 11) — **M**
1. Restyle our `admin-panel.pug` (page-shells module) to the `/admin/site` vocabulary: same header bar (title "Admin Panel"), same left-nav styling (reuse the `ce-admin-*` classes; R11-1 pin applies), nav items = the 4 tab sections (System Messages / Active Projects / Open Sockets / Open/Close Editor) in **both themes**.
2. Nav items drive the existing `ol-tabs` panes (click → select pane + keep hash bookmark); upstream endpoints (`/admin/messages`, `/admin/closeEditor`, …) and partials untouched.
3. **Verify:** tabs switch on nav click; hash restores pane on reload; system-message post/clear still work; active-projects panel still streams; dark + light both readable.

### R11-11 — theme selector on /admin/site (item 14) — **M**
The Dark/Light/System selector currently exists in the **project-list left sidebar** (`frontend/js/features/project-list/components/sidebar/theme-toggle.tsx`, the exact `theme-toggle-radios` fieldset) but is **missing on `/admin/site`** (verified: no `theme-toggle` on that page).
1. Extract/reuse the same fieldset as a shared component (move `theme-toggle.tsx` into a module-owned location — see R11-12 — and import it from both call sites; or render the identical markup in the admin-tools React app if a cross-import is cleaner).
2. Placement: `/admin/site` header/sidebar area (the `manage-site.tsx` page root, `manage-extensions-page`), always visible in both themes.
3. **Two-way persistence:** read the current admin theme (the `ol-adminOverallTheme` meta = `ace.overallTheme` used by `/admin`, `/admin/panel`), and on change **write both** `localStorage['ol-theme']` (app pages) **and** the stored user theme (`ace.overallTheme` via the user-update path — verify the exact endpoint; `POST /user/settings` or the ace endpoint) so the choice follows the user across admin **and** user pages; refresh the `ol-adminOverallTheme` meta client-side (or single-page re-render) so admin surfaces re-theme immediately.
4. Add to the account-menu pages too only if cheap (the account menu already carries the radios per R10 notes) — but the /admin/site gap is the requirement.
5. **Verify:** picking Light on /admin/site → /admin, /admin/site, /admin/panel, /project, /library, /templates all become light; Dark/System follow the same way; persistence survives reload; the three radios + icons render exactly like the reference fieldset.

### R11-12 — module hygiene: move fork code into `modules/` (item 16) — **L**
Goal: minimize the fork's footprint **outside** `services/web/modules/` so future upstream merges are low-risk. **Measured inventory (git, commits `92c64b965e..HEAD`):** 46 fork-authored files already inside `modules/` vs **16 outside**:

| Outside `modules/` file | Fork delta | Classification |
|---|---|---|
| `frontend/stylesheets/pages/ce-navbar-consistent.scss` | 100% ours (new file) | **MOVE** → module stylesheet (e.g. new `modules/ce-ui/`, or admin-tools if we don't want a new module), import from the one `all.scss` line (keep that 1-line touchpoint documented) |
| `frontend/js/shared/components/sidebar/ds-nav-page-switcher.tsx` | 100% ours (new file) | **MOVE** → module (ce-ui / project-list owner) + imports updated at the 2 call sites |
| `app/src/Features/SiteSettings/EnvHydrator.mjs` | 100% ours (new file) | **MOVE** → module (admin-tools or new `ce-core`); load it via `moduleImportSequence` import side-effect instead of the `app.mjs` import line (delete the app.mjs delta) |
| `app.mjs` | +1 import line (EnvHydrator boot) | Becomes **zero delta** after the EnvHydrator move |
| `frontend/stylesheets/pages/admin/admin.scss` | appended CE+ pin block (W6/R10) | **MOVE the appended block** into a module stylesheet that `admin.scss` imports (or into `ce-ui`); keep ≤1 import line in upstream file + comment pointing at the module |
| `frontend/stylesheets/pages/all.scss` | our import lines | keep ≤2 documented import lines (entrypoint for module styles) |
| `frontend/js/shared/components/navbar/account-menu-items.tsx` | 'Manage template gallery' item + retargets (Manage Site → /admin/panel, Account settings → /user/mysettings) | **PARTIAL MOVE**: 'Manage template gallery' + retargeted URLs can be driven through the existing `navExtraItems` module hook if its shape allows item *replacement* — check `admin-menu.tsx`/hook shape; the 2 URL-retargets may need to stay (document) unless a replace-hook is added to the module |
| `app/src/infrastructure/ExpressLocals.mjs` | added meta (adminOverallTheme, template flags, csrf) | **KEEP** (core view-meta touchpoint; minimal, documented) |
| `app/src/Features/SiteSettings/SiteSettingsManager.mjs` | stored-sections API (get/validate/allow-list) | **KEEP** (core API many modules import; minimizing = stable API surface, documented) |
| `app/src/Features/User/UserPagesController.mjs` | login view merges stored SSO sections | **KEEP-MINIMAL** (3-line merge block; alternative = module login-view hook — out of scope, note in report) |
| `app/views/user/login.pug` | SSO provider buttons on the form | **KEEP-MINIMAL** (view markup inside an upstream page; a module view-injection hook would be the clean move — evaluate in the audit, only if low-risk) |
| `config/settings.defaults.js` | `moduleImportSequence` + SSO defaults + module import hooks | **KEEP** (the fork's own registration pattern — modules are discovered through it by design) |
| `frontend/extracted-translations.json`, `locales/en.json` | our i18n keys | **KEEP** (central i18n data; module strings also flow through the same catalogs) |
| `frontend/js/features/file-tree/contexts/file-tree-actionable.tsx` (+ a few older-round files: `LinkFiles*` controllers, `EditorHttpController`, `ProjectEntityUpdateHandler`, `EmailSender`, `sharejs.js`, `User.mjs`, `mongodb.mjs`) | older-round integration hooks | **AUDIT**: if an existing upstream hook/command-registration covers it (e.g. file-tree action registration like `menubarExtraComponents`), migrate; else keep + document in the report |
| `test/unit/src/site-settings.test.mjs` | our tests | **MOVE** → `modules/admin-tools/test/unit/src/` (colocate tests with the module they test) |

**Deliverables:** (1) moves executed with import updates + `moduleImportSequence` registration where needed; (2) lint/build/E2E spot-check of every affected surface (navbar, admin console, SSO login, project list sidebar, +Add file-tree menu, site-settings tests); (3) **`MODULE_HYGIENE_REPORT.md`** — the final list of *unavoidable* upstream touchpoints with a one-line justification each (the "keep" rows above), so the next upstream merge is a guided 3-file diff. **Hard rule:** the 46 already-in-module files + `page-shells`/`admin-tools`/`template-gallery`/`bib-editor`/`orcid-picker`/`zotero` stay untouched by this workstream's churn (moves only, no behavior changes).

### R11-13 — intensive bug hunt (item 17) — **L**
Systematic, careful sweep across **every fork surface**, in **both themes**, plus the API layer. Method: (a) live CDP passes with a console-error capture hook on every page below (any `window.onerror`/`unhandledrejection` is a findings line); (b) API-level probes for the admin endpoints (valid/invalid/edge payloads, CSRF on, wrong-role where possible); (c) code audit of the 46 module files + 16 touchpoints for: unguarded `await`s, missing error handling in admin POSTs, i18n key gaps (`t()` raw-key leaks), React key/prop hazards, storage-key collisions, rate-limiter reset gaps, SSO config edge cases (enable mid-session, malformed stored JSON, empty host); (d) targeted unit tests where a defect is found (each fix ships with a test).
**Sweep matrix (order):**
1. **Auth & SSO**: password login, SAML/OIDC/LDAP logins + SLO, account menu on /project·/library·/templates·/admin site, session expiry, concurrent admin actions.
2. **Admin console**: all 13 tabs × save + reload persistence; e-mail test endpoint (rate-limit, invalid addresses, stored-config errors); SSO enable/disable live; template-admins grant/revoke; linked file types; Pandoc; sandboxed compiles (values survive restart semantics — check the env-hydrator output `docker exec env | grep OVERLEAF_` after a save).
3. **Templates**: gallery list/search/sort, create from project, edit in place, bundles table (download/import file + URL, 409/422 paths, concurrent import), delete, publish-as-template (modal fields, category, overwrite), /templates/manage full pass (dark + light).
4. **Bib surface**: /project panel (add/paste/DOI/ORCID/Zotero, bulk, split, collapse, delete confirm), /library (add/import/preview/search/cards in dark + light), file-tree +Add items, out-of-sync after concurrent edits.
5. **Shells**: /admin/panel (all tabs + forms), /user/mysettings (all sections), /admin, /user/settings (upstream parity), cross-links, 404/not-admin paths.
6. **Cross-cutting**: i18n raw-key leaks (grep rendered text for `adminSite.`/`t(` patterns in DOM), console-error capture on every page above, responsive sanity (narrow viewport) on the 5 busiest pages.
**Deliverable:** `BUGHUNT_ROUND2_REPORT.md` (findings with severity P0–P2, repro, root cause, fix commit, verification) + all fixes folded into the final build.

---

## Sequencing & builds

| Batch | Workstreams | Build |
|---|---|---|
| A (quick wins, one build) | R11-1, R11-2 (incl. item 15: red stays on admin surfaces only), R11-3, R11-8 | build N → deploy → verify |
| B (template admin) | R11-6, R11-7 | build N+1 → deploy → verify (bundles tab + import flow) |
| C (bib parity) | R11-4, R11-5 | build N+2 → deploy → verify (library vs project, both themes) |
| D (shells + theme) | R11-9, R11-10, R11-11 | build N+3 → deploy → verify (both shells + theme selector, both themes) |
| F (module hygiene) | R11-12 | build N+4 → deploy → verify (navbar, admin console, SSO login, sidebar switcher, +Add menu, site-settings tests) |
| G (bug hunt) | R11-13 sweep → fixes → full regression (SAML/OIDC/LDAP, publish flow, 13 admin tabs, 9/9 split, account menu, templates/manage) | build N+5 → push + `BUGHUNT_ROUND2_REPORT.md` + `MODULE_HYGIENE_REPORT.md` |

Unit tests touched: `page-shells.test.mjs` (shell nav + mirror assertions), `email-test.test.mjs` unchanged, new `bundle-import` manager tests (R11-7), `admin-tools` user-list tests for the templateAdmins query (if a runner exists — else inline vitest file). Lint stays `--max-warnings 0`.

## Risks
- **R11-3** removes theme-switcher/logout from /project + /library top-navs (user's explicit markup; theme selector added to /admin/site via R11-11, still reachable on /templates).
- **R11-2** solid white navbar in dark mode: confirm nav-link contrast (dark text) + brand image variant.
- **R11-9** anchor discovery: if a section lacks a stable id, the shell falls back to heading-text anchors — no upstream file edits (hard constraint intact; unit tests assert upstream byte-identical).
- **R11-11** dual persistence (localStorage + `ace.overallTheme`) can diverge — pick ONE source of truth (stored user theme wins) and mirror the other on write; verify the admin `ol-adminOverallTheme` resolution script still gets the right value.
- **R11-12** moves are import-shape changes only — any behavior change in a moved surface (navbar, switcher, env-hydrator boot order!) aborts the move (boot order: EnvHydrator must still run before Settings consumers; verify via a `docker exec overleafserver env | grep OVERLEAF_EMAIL_HOST` check after the move).
- **R11-13** bug hunt may surface P0s — those jump the queue and ship in the same build as the hunt (no half-states).
- **R11-7** fix may touch the *client* import error path (shared chunk) — keep changes minimal and route-guarded to avoid template-admin regressions; the 409/422 contracts must survive.
- Build env: Docker Hub registry-cache flakiness — retry; `precompile-pug` pre-gate for any pug changes (R11-9/10 views).
