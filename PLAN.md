# PLAN — overleaf-cep (live: psintern.neuro.uni-bremen.de)

**Single source of truth for open work.** The round documents in this repo
(`UI_ROUND10_PLAN.md`, `UI_ROUND11_PLAN.md`, `UI_ROUND12_PLAN.md`,
`SSO_MULTI_PROVIDER_PLAN.md`, `BIB_ORCID_TEMPLATES_PLAN.md`,
`BUGHUNT_REPORT.md`) are **historical logs** — wherever they disagree with
this file, **this file wins**.

Last updated: **2026-09-01 (evening)** — user re-report #2 (6 items): 1A/1B
`/user/mysettings` theme, 3/4/5 `/admin/instance-stats` (anchors/H2 + images + line charts), 6 `/admin/site` Miscellaneous —
**ALL 6 IMPLEMENTED** and lint clean (instance-stats 30/30, page-shells 7/7,
admin-tools 35/35). Item 6 = new **Miscellaneous** tab (14 fields; see
`TOOLKIT_ENV_GAP.md`). Ready for your `make all` → cycle → verify.

---

## 1. OPEN items (newest first)
### N-2 round 3 (P0, user-reported 2026-09-01 build 50) — in progress
User feedback on the live container (build 50):
1. `/user/mysettings`: **A** sidebar account icon broken (style + no menu
   opening) — root cause: shared chrome rendered a raw `<button>` outside
   `Dropdown.Toggle` (no react-bootstrap control on a page without
   Bootstrap JS) → replaced by the EXACT golden `site-settings-page.tsx`
   dropdown (Dropdown.Toggle + Dropdown.Menu as=ul + popper offset).
   **B** sidebar section buttons restyled to the golden
   `ul.user-list-filters > li.active > button` (custom
   `.my-settings-nav-btn` class + ce-admin-shells overlay removed;
   active class now on the `li`). **C** navbar Account item — hidden at
   lg+ by the golden CSS (`.user-ds-nav-page .navbar-default
   .nav-item-account{display:none}`) once the page div scope is in place
   (verified in build 50 DOM probe). **D** theme awareness — restored
   once the ThemeToggle (inside the fixed account menu) is reachable;
   page follows `ol-userSettings` via `useThemedPage` (same as golden).
2. `/admin/panel`: sidebar `li>a.nav-link` → golden `li>button`; same
   account-menu fix (shared chrome).
3. `/admin/instance-stats` (N-D page) rebuilt to the golden skeleton:
   **A** red admin gradient (`.red-nav-bar-for-admins`), **C** left column
   (`.user-list-sidebar-wrapper-react`), **D** tabs (User/Project/
   Storage/System/Alert settings) moved into the sidebar
   (`.user-list-filters` + `li[data-pane]` pane switching in the page
   entry), **E** Admin/Account removed from the header (shared React
   DefaultNavbar + golden CSS), gold-standard pill buttons (same shared
   CSS). Layout switched `layout-marketing` → `layout-react` (same
   suppression pattern as both shells).
   **B** Alert settings multi-email (textarea, one address per line,
   commas OK) — `alertEmails[]` on the config doc (legacy `alertEmail`
   kept), controller validation + per-recipient test mail +
   per-recipient threshold alerts; settings panel rewritten; tests
   updated (30/30 green).
4. `/register` (and `/login` per user decision): header = **brand only**,
   no nav elements, in every session state (`suppressNavbarRight = true`
   unconditionally in both views; content "Login here" links kept).

Files: `ds-nav-chrome.tsx`, `pages/instance-stats.ts`,
`app/views/instance-stats.pug` (rewrite), `InstanceStatsController.mjs`,
`alertChecker.mjs`, `InstanceStatAlertConfig.mjs`, `settingsPanel.ts`
(+test), `user-my-settings.pug`, `admin-panel.pug`, `my-settings-shell.js`,
`ce-admin-shells.scss`, `login.pug`, `register.pug`.

**Verification after build 52:** mysettings+panel (account menu opens /
theme toggle works / sidebar pills / active states / dark+light),
instance-stats (red navbar, sidebar tabs, plots render from the VENDORED
`/plotly-3.0.1.min.js`, multi-email save + test mail), /register + /login
brand-only header (anonymous + logged-in), /admin/site + /admin/panel
regression (tabs, project list).


### N-2 (P0, user-reported ×4) — `/user/mysettings` + `/admin/panel` layout
**STATUS (2026-09-01, image 49b):** autoformat (N-C) verified working by the user,
but the N-B2 navbar change and the N-2 content-column theme change are **NOT
visibly improved yet** → root-cause pass queued top priority (bundle audit of
`user-ds-nav-content` rules + computed-style diff dark/light on both pages +
logged-in /register probe).
**still broken** — "not dark/light theme aware", structure wrong.
**Target reference (golden): `/admin/site` exactly** — reverse-engineer its
live DOM first (probe), then clone structure + classes so both pages
inherit the same behavior:

**2a `/user/mysettings`:**
- `2a-1` navbar: currently full app navbar (Admin/Library/Templates/
  Projects/Account) — user: "compare with /admin/site; should have 3
  elements" → replicate /admin/site's navbar item set.
- `2a-2` **two scrollbars on the right** → single content scrollbar
  (`.my-settings-main` card must not add its own vertical scroller on top
  of the page one).
- `2a-3` left nav (`Update account info / Update password / Project
  synchronisation / Reference managers / Linked accounts / Sessions`)
  must sit **below the page header**, not on top of it.
- `2a-4` `h1 "My settings"` must be the **header of the right column**,
  with the settings content (account info forms, git tokens, zotero/oidc
  widgets, sessions) **below it in the right column** — not stacked under
  the left column.
- `2a-5` left column must include the `.ds-nav-sidebar-lower` block
  (account dropdown + "CE+" name) that /admin/site has.
- `2a-6` **dark/light theme awareness** for the whole page (sidebar,
  content surface, text) — today hard-coded white.

**2b `/admin/panel`:**
- `2b-1` navbar: same as 2a-1 (should have the /admin/site 3-element set).
- `2b-2` `#main-content.admin-panel-shell` (h1 + left nav + tab panes)
  renders **on top of the header** → must sit **below the header** (same
  placement as /admin/site content).
- `2b-3` left column must include the `.ds-nav-sidebar-lower` block
  (account dropdown + "CE+") like /admin/site.
- `2b-4` **dark/light theme awareness** for the whole page (today
  hard-coded white — build 46).

**Method:** browser-probe `/admin/site` (sidebar markup/classes, navbar
items, header placement, scroll containers, theme classes in both themes)
→ rebuild `modules/page-shells/app/views/{user-my-settings,
admin-panel}.pug` + `modules/ce-ui/frontend/styles/ce-admin-shells.scss`
to the same skeleton → build 47 → verify both themes, no double
scrollbars, correct column order, sidebar-lower present.
**Note:** this OVERRIDES the build-46 "white in both themes" approach for
these two pages — they follow /admin/site's theming (theme-aware).

### N-1 (P1, user-reported) — anonymous navbar on `/register`
Logged-out users must NOT see the logged-in nav cluster (Projects link +
Account menu + admin items) on `/register`. Hide the Projects pill and
Account/LogOut cluster for anonymous sessions (and mirror to whatever
`/login` does); keep brand + (Login) visible. Find the navbar render site
(`frontend/js/shared/components/navbar/*` or the layout-marketing block)
and gate on `req.user`/`isUserLoggedIn`. Verify anonymous `/register`
navbar is minimal while logged-in admin navbar is unchanged.

### N-B (P1, new) — toolkit env-coverage gap analysis
`~/junk_bib/toolkit` = the **default** deployment toolkit (assumption:
user is forced to `SERVER_PRO=false`). Goal: **user runs the default
toolkit; every fork difference is configured through `/admin/site`**
(site_settings sections, sorted as today). Deliverable: a **gap table**
— every `process.env.*` parameter referenced by
`services/web/modules/*` (our CE+ modules: admin-tools, authentication,
bib-editor, orcid-picker, page-shells, registration-page,
server-ce-scripts, template-gallery, zotero) + `config/settings.defaults.js`
that is **not** already surfaced/read by site_settings sections
(email, externalUrl, git-integration, github-sync, linked-file-types,
pandoc, sandboxed-compiles, signup, sso-ldap, sso-oidc, sso-saml,
templates, zotero) → classify each: (a) covered by /admin/site, (b) must be
added as a new section/key, (c) legitimately env-only (infra: ports,
mongo, redis, secrets that belong in compose, LICENSE/keys). Output:
`TOOLKIT_ENV_GAP_MATRIX.md` + the list of sections to add so the default
toolkit "just works" with `/admin/site` for the rest.
**Do NOT change env handling in this item — analysis + matrix first;
implementation only after the matrix is accepted.**

### N-C (P1) — integrate autoformat (tex-autoformatter) — ✅ LIVE + USER-VERIFIED (2026-09-01)
Actual shape (found in the old repo e5edadaa84): services/web/modules/tex-autoformatter —
POST /api/format-tex (CSRF is global per webRouter; requireLogin) with **tex-fmt** for
.tex/.cls/.sty and **bibtex-tidy** for .bib, plus an editor toolbar end button
(sourceEditorToolbarEndButtons).
Integrated into overleaf-cep:
* module ported under services/web/modules/tex-autoformatter (controller, router,
  button; button hardened: disabled while running, no-console exempted, on-failure
  the document is left untouched),
* **tex-fmt v0.5.7 vendored** static x86_64 build at server-ce/static/bin/
  (sha256 in server-ce/static/bin/README.md), COPYd to /usr/local/bin/tex-fmt in
  server-ce/Dockerfile (not in Ubuntu 24.04 apt; not on host PATH either),
* **bibtex-tidy pinned 1.14.0** in services/web/package.json — **1.15.x requires
  Node 26+** (Map.prototype.getOrInsert(), TC39 Upsert, stable unflagged only in
  Node 26 / V8 14.6, ~May 2026); our runtime is Node 22.21.1 so every 1.15.x call
  crashes (seenFieldsByEntry.getOrInsert is not a function), verified
  clean-install for 1.15.0 + 1.15.1; evidence + upgrade rule documented in the
  module README,
* config/settings.defaults.js: toolbar end button entry + moduleImportSequence
  entry (end of array),
* unit tests modules/tex-autoformatter/test/unit (route shape, 400 validation,
  real bibtex-tidy .bib invariants, tex-fmt path auto-skipped when binary absent —
  runs in-image): **5 passed / 1 skipped**; module lint clean (eslint --max-warnings 0).
Remaining: build 50 + image cycle + live E2E (toolbar button visible; format .tex +
.bib via API: 200 with CSRF token / 403 without / 401 anon; document updates via
the editor dispatch).

### N-B2 (P1, new) — /register + /login navbar for a LOGGED-IN visitor
User re-report (2026-08-31, build ≥48): logged in as admin, the auth pages show the
full cluster — Admin dropdown, Projects, Account menu — which the user wants REMOVED
on those pages ("a not logged-in user shouldn't see this").
**STATUS (2026-09-01):** ships in image 49b (00:51 UTC) but **user reports no visible
change** — INVESTIGATING (bundle containment + computed-style audit; see handoff
queue item (b)). **Fix (2026-08-31, in work for build 49):** navbar-marketing.pug —
isAuthPageMinimalNav (currentUrl ∈ {/login, /register} && session user) renders the
minimal branch (Library / Templates / Log in, so account switching stays possible)
and forces suppressAdminNavMenu for that visitor. Guarded to the two auth pages.
(Anonymous views were already minimal since build 47 — verified live.)
### N-D (P1, new) — integrate stats_feature admin dashboard (user 2026-08-31)
Source: `~/junk_bib/stats_feature` — admin **dashboard** module from an old CE+
overleaf version.
**Requirements (user):**
1. New menu item **"Dashboard"** in the navbar **Manage submenu, ABOVE "Manage
   Site"** (pasted live dropdown 2026-08-31: Manage → *Dashboard* → Manage Site →
   Manage Extensions → Manage Users → Manage Projects + Theme + Log Out),
2. **Every dependency must be fetched during the docker image build** (npm deps in
   the web package.json + vendored binaries via Dockerfile COPY; NO runtime manual
   installs — same rule as the tex-fmt vendor in server-ce/static/bin),
3. **UI must match the /admin/site golden style** (CE+ admin shell: white admin
   surfaces in both themes per standing constraint OR the /admin/site themed
   skeleton — decide during port; user says current stats_feature style is
   "rather different" and must be adapted),
4. **Intensive testing after integration** (unclear code quality + old CE+
   coupling): unit tests for the new module, lint clean, build, image cycle, E2E —
   page renders for admin (and 403/redirect for non-admin), API endpoints correct
   (CSRF where required), both themes, console clean; adapt any old-core imports
   (paths, privilege enums, settings keys) and remove PRO-only surfaces.
**Status (2026-09-01):** AUDIT COMPLETE — source is the `instance-stats` module
(`module-files/instance-stats`, 24 files incl. 3 vitest test files) + a 10-file
external patch. Integration map (verified in current fork):
* module → `services/web/modules/instance-stats` (copied, verbatim),
* host model `app/src/models/InstanceStat.mjs` (extracted from the patch),
* host imports all exist (RedisWrapper, Mongoose.connectionPromise, EmailSender,
  AuthorizationMiddleware.ensureUserIsSiteAdmin), MockResponse test helper exists,
* **Plotly: package loads it from CDN — VIOLATES user requirement "all deps
  downloaded during image build" → vendor `plotly-3.0.1.min.js` into
  `services/web/public/` (served at site root via ServeStaticWrapper) and change
  the view to `/plotly-3.0.1.min.js` (+ sha256 note) — NO npm dep needed,**
* cron: image already runs `runsv cron` + /etc/cron.d pattern (crontab-history /
  crontab-deletion) → package's crontab-instance-stats + collect-instance-stats.sh
  + Dockerfile ADD hunk apply directly,
* menu "Dashboard" goes in `frontend/js/shared/components/navbar/account-menu-items.tsx`
  `ManageMenu` items array (ABOVE 'Manage Site'), flag from ol-navbar meta
  (`canDisplayInstanceStats`, settings.instanceStats.enabled), mirrored in the
  non-React navbar-marketing.pug Admin dropdown,
* UI: restyle the view to the /admin/site golden style (themed shell; admin
  surfaces per standing constraint; i18n keys in en + extracted-translations),
* settings: `instanceStats { enabled, retentionDays }` block + moduleImportSequence
  entry,
* tests: the shipped 3 vitest files + collector seed/verify runs in-image +
  intensive E2E (admin 200 / non-admin 403, both themes, console clean, alerts
  round-trip, collector output in mongo).
Partially staged already (safe, not wired): module dir + InstanceStat model.
**Next build (user is running `make all` 2026-09-01): will include everything
currently staged (N-B2 + N-2 attempt + N-C + Dockerfile bin + module files).
N-D wiring (menu/flags/styling/Plotly vendor/cron/i18n) lands in the FOLLOWING
build together with the N-B2/N-2 re-fix.**

### N-F (P1) — Share modal "add" fails live — **NEW EVIDENCE 2026-09-01**
**LATEST LIVE ERROR (user 2026-09-01):** `ReferenceError: owner is not defined`
at `G (7709-ec2503b60d62ce7324b9.js)` surfacing through
`componentDidCatch @ manage-projects-*.js` — a render-time **free identifier**
`owner` (not null/undefined — a variable that was never declared in that
component).
**Audit started:** fork's `modules/admin-tools/.../share-project-modal.tsx`
uses a guarded `owner` STATE (`owner && <tr>…`) — likely fine;
`features/share-project-modal/components/owner-info.tsx` uses
`project?.owner.email` — fine; delete/leave buttons `project.owner` guarded —
fine. **Culprit not yet identified → next step: map minified `G` to source
(grep every component in the manage-projects graph for a bare `owner`
identifier + tsc no-undef on the module) and fix.**
After that: full cycle E2E — add `test2@example.com` (readAndWrite) → 201 +
row; change role; **remove member** (user item A: add / delete / change
permissions); invite → cancel; owner row visible; sharing link copy.
---
`/admin/project` → **Share** (person_add) modal: members/invites/
sharing-link fetches work (verified calls), but **adding a person via
`POST /admin/project/:id/invite` returned "Something went wrong"** for
`test2@example.com`. Investigate: CSRF token meta name (`ol-crfToken`
vs actual), invite email policy (`_checkShouldInviteEmail` / allowed
domains), `cannot_invite_self` edge, rate limiter. Fix + verify full
cycle: add → appears → change role → remove; invite → cancel; link
copy. (API routes + button + modal + i18n are **done**, build 46.)

### O1 (P2 → demote) — Batch G sweep G3: admin-API edge-case sweep — NOT RUN
(Promote again if N-B/N-C stall.) Same acceptance as before: tab × case
× status table, secrets never plaintext, unknown keys 422, sso toggle
removes login button, sandboxed-compiles list round-trip, externalUrl
regex validation.

### O2 (P2) — Batch G sweep G6: bib/editor + library — NOT RUN
Project flow: .bib sync both directions; entry CRUD; DOI/ORCID/Zotero
wired; resizer persistence; /library list/reorder/delete/import-export +
scrollbar; "Out of sync" no regression. Results → O3.

### O3 (P2) — `BUGHUNT_ROUND2_REPORT.md` — NOT WRITTEN
Must contain: P0 incident (own-suite root cause + oplog proof + 3-layer
defense + proofs), G1 20/20, G2 SSO E2E pass, G3+G6 tables, R12 +
R12-15/16/17 one-liners with build refs, known non-issues.

### O4 (P2) — Pre-existing core-suite flakiness (~17 files / ~183 tests)
Baseline without our changes: **185 failing**; with: 183. Not a
regression; CI unreliable. Direction: `forks`/`threads` + `isolate:true`
for affected projects; audit shared state. Out of scope until N-* close.

### O5 (P3) — `/user/mysettings` & `/admin/panel` height/overflow
Subsumed by N-2 (layout rebuild). Re-check after N-2.

### O6 (P3) — Image tag hygiene
Tag = commit at build time; working-tree-ahead builds tag one behind.
Consider commit-before-build in the build script.

---

## 2. Status of user items #9–#12 + A (2026-08-31)

| # | Item | State |
|---|---|---|
| 9 | `/admin/panel` + `/user/mysettings` styling | **Partially** (build 46: white cards, red admin nav, padding/id-dup fixed) — **still broken** per user → **N-2** (theme-aware + /admin/site structure) |
| 10 | Projects pill on 5 pages | **DONE + verified** build 46 (`display:flex` on /project, /library, /templates, /templates/manage, /template/:id) |
| 11 | /library scrollbar | **DONE + verified** build 46 (parent `.bibtex-entry-list` overflow=clip; body oy=auto, 2 entries) |
| 12 | /register (signup on) | **DONE (code) build 46** — root cause: `!allowPublicAccess` → `requireGlobalLogin` bounced anon /register to /login before the per-request admin gate; whitelisted /register unconditionally so `signup.enabled` governs. Anonymous `GET /register` → **200 + form** verified. (See §3) |
| A | /admin/project share list | **API+UI DONE build 46** (routes in AdminToolsRouter reuse core controllers; Share button + modal + i18n) — **add-action failing live → N-F** |
| new 1 | anon navbar on /register | **N-1** |
| new 2 | theme-aware /admin/site-parity shells | **N-2** |
| new B | toolkit env-coverage gap analysis | **N-B** |
| new C | autoformat integration | **N-C** |

---

## 3. Incident log (summary)

| Incident | Root cause | Defense | State |
|---|---|---|---|
| Lost stored site settings (SSO/SMTP/sandbox) 2026-08-30/31 | Our own unit tests (shared worker bound default mongo `sharelatex` before per-file env); cleanups hit live doc | unit-env setup file + manager tripwire + per-test guards + snapshots/restore | **CLOSED + PROVEN** |
| Anonymous `/register` → 302 /login even with `signup.enabled=true` (2026-08-31) | `!Settings.allowPublicAccess` mounts `webRouter.all('*', requireGlobalLogin)`; `/register` only whitelisted when `Features.hasFeature('registration-page')` (off under SSO) → anon bounced before the per-request admin gate | `app/src/router.mjs`: whitelist `/register` unconditionally; `site_settings.signup.enabled` stays the authority (module `ensureRegistrationEnabled` still enforces GET-redirect/POST-403) | **CLOSED** (build 46; anon 200+form verified) |
| Bundle "Import from URL" 500 | `fetchWithPolicyRedirects` missing from UrlAgent export surface | exposed + pre-check first hop + regression suite | **CLOSED** (build 45) |
| Placeholder lost `https:` | i18next parsed `https://` **key** as ns | safe key, URL in value | **CLOSED** (build 45) |
| Console `Permissions-Policy attribution-reporting` | obsolete directive | removed from settings.defaults.js | **CLOSED** (build 45) |
| LDAP SSO "live login drops" | stored `sso-ldap` wiped (incident 1) | restored via admin API | **CLOSED** (E2E pass) |

---

## 4. Closed rounds (history in linked files)

- **P0–P4, R1–R9** — DONE.
- **R10** (13) — build 33. **R11** (17, A–F) — build 42.
- **R12** (14) + **R12-15/16/17** — builds 42–45.
- **User items #10, #11, #12, A(api+UI)** — build 46 (see §2).

**Next actions (priority order):**
1. **N-2** (theme-aware /admin/site-parity shells) — probe /admin/site, rebuild both shells, build 47, verify both themes.
2. **N-1** (anon /register navbar) — hide logged-in cluster.
3. **N-F** (Share modal add) — fix invite add live.
4. **N-B** (toolkit env gap matrix) — analysis → `TOOLKIT_ENV_GAP_MATRIX.md`.
5. **N-C** (autoformat integration) — port + bug-check + tests.
6. O1→O2→O3 (sweeps + report) once N-* land; O4/O6 optional.

**Build/verify loop reminder:** every command **with `timeout N`** (no
unbounded `docker logs --follow`/`make` waits). Build: `cd server-ce &&
image_tag=<n> make all` (nohup, poll with bounded sleeps); deploy:
`cd /data_1/docker/compose_cep && bash cycle_overleafserver.sh`; then
live-verify via CDP driver + `timeout`.

## 5. HANDOFF SNAPSHOT (2026-09-01 ~01:30 UTC — user away until feedback)
**State: USER is running `make all` on the working tree (started by the user,
2026-09-01). Working tree contains: N-B2 navbar fix, N-2 theme-attempt scss,
N-C autoformat (module + tex-fmt Dockerfile + bibtex-tidy pin), N-D partial
(module dir + InstanceStat model, NOT wired), Makefile cache-from fix.**
**Verified by the user on image 49b (cycled by user):**
* ✅ **N-C autoformat WORKS** (toolbar button + formatting).
* ❌ **N-B2** /register+/login logged-in navbar: **no visible improvement** →
  re-verify logged-in explicitly (probe logs in first), then audit the served
  HTML for the minimal nav.
* ❌ **N-2** dark/light content-column theme on both shells: **no visible
  improvement** → audit: (1) is the `ce-admin-shells.scss` rule in the served
  bundle? (grep `user-ds-nav-content`), (2) computed `background-color` of
  `.user-list-wrapper` / `.user-ds-nav-content` / `main` on both pages, dark
  vs light, (3) find the cascade winner (a `.card`/`main`/bootstrap rule may
  win) and override scoped + deliberate.
**Queue after user feedback (order):**
 (a) RE-FIX N-B2 + N-2 with the audits above (top priority — user's two open),
 (b) N-D instance-stats wiring: menu flag ("Dashboard" above "Manage Site"),
    Plotly vendoring (public/ view change), /admin/site-style UI + i18n, cron,
    settings block, tests run, build, intensive E2E,
 (c) N-C API/CSRF matrix polish (optional, feature already user-verified),
 (d) BUGHUNT_ROUND2_REPORT.md + G3/G6 sweeps,
 (e) commit + push ALL (N-1…N-F + N-B…N-D + Makefile + Dockerfile + package),
 (f) O1–O4 leftovers per original plan.
**Known-good operational facts:**
* Build: `cd server-ce && nohup make all > /tmp/ol_buildNN.log &`; Makefile now
  uses local inline cache (CACHE_FROM_* overridable, default empty) — the old
  `--cache-from <branch-tag>` failed on Docker Hub (tags only exist locally).
* Deploy: `cd /data_1/docker/compose_cep && bash cycle_overleafserver.sh`
  (user has been cycling manually — coordinate to avoid double cycles).
* tex-fmt vendor: server-ce/static/bin/tex-fmt (v0.5.7, sha256 in the README
  next to it), COPY to /usr/local/bin in server-ce/Dockerfile.
* bibtex-tidy: pinned **1.14.0** (1.15.x needs Node 26+ Map.getOrInsert;
  runtime is Node 22) — evidence in modules/tex-autoformatter/README.md.

## 6. N-2 STRUCTURAL REBUILD (2026-09-01 night, user asleep 8-10h)

### New user confirmations (folded into design)
- **/admin/panel has the same h1 issue**: `li.dropdown-header "Admin Panel"` renders
  upper-left UNDER the header — because the sidebar lacks the column wrapper.
  Fix = same column wrapper as /admin/site (the header then sits at the TOP OF THE
  SIDEBAR COLUMN, exactly like the golden's "Manage Extensions" header).
- **/admin/site header does NOT show the Account button** (hidden, not present):
  achieved by `.user-ds-nav-page .navbar-default { @media lg { .nav-item-account {
  display:none } } }` — only matches when the navbar is INSIDE `.user-ds-nav-page`.
  Our rebuild must reproduce this (mobile collapse keeps the account menu).

### Root cause (verified against code, builds ≤49b)
Both shells used the wrong DOM skeleton for the shared DS-nav CSS:
1. navbar rendered by the LAYOUT (outside `.user-ds-nav-page`) → red gradient
   (`.red-nav-bar-for-admins .navbar-default`) never matches; no account-hiding;
   mysettings navbar not theme-aware (layout navbar, not page navbar).
2. `nav` + `.ds-nav-sidebar-lower` were direct children of `.user-list-wrapper`
   — the REQUIRED `.user-list-sidebar-wrapper-react` column wrapper was missing
   → no left column; sidebar items laid out across the top.
3. `.user-ds-nav-content-and-messages` was a sibling of (outside) `.user-list-wrapper`
   → content BELOW the sidebar instead of RIGHT.
Static `data-bs-toggle` account dropdowns are dead on layout-react (no bootstrap JS).

### Fix (exact golden mirror: manage-site-react / manage-users-react pattern)
- Both views: `layout-react` + `const suppressNavContentLinks/suppressNavbar/
  suppressFooter/suppressPugCookieBanner = true`;
- `ol-userSettings` (UserSettingsHelper.buildUserSettings, golden pattern) +
  `ol-overallThemes` (res local) metas in both views;
- New `modules/page-shells/frontend/js/components/ds-nav-chrome.tsx`: renders the
  shared React chrome into shell mounts — `DefaultNavbar` (page navbar, inside the
  page div), `AccountMenuItems` dropdown (email, account settings, ThemeToggle,
  logout — the shared store/POST), `Footer`, `CookieBanner`; SplitTestProvider +
  UserSettingsProvider + useThemedPage (same as SiteSettingsRoot);
- Views: exact golden DOM — `#*-navbar-root` inside `.user-ds-nav-page`;
  `.user-list-sidebar-wrapper-react.d-none.d-md-flex` wrapping sidebar nav +
  `.ds-nav-sidebar-lower` (React account menu + CE+); `.user-ds-nav-content-and-
  messages` INSIDE `.user-list-wrapper`; footer + cookie mounts in the golden's
  slots; panel keeps the red class, mysettings stays neutral;
- Static theme radios + their JS removed (replaced by the shared ThemeToggle);
- Panel entrypoint stays 'marketing' (same CSS/JS assets as today); mysettings
  'pages/user/settings' (unchanged).
- Tests updated (layout-marketing → layout-react), scss dead-block removed.

### Night work order
1. Code above (this commit)
2. lint + page-shells unit tests
3. `make all` (build 50) → cycle → live-verify both pages (dark+light, structure,
   account menu, theme toggle, tabs/scrollspy, no account button in header,
   single scroller, red gradient on /admin/panel)
4. N-B2: logged-in probe of /login + /register navbar
5. N-F: `owner is not defined` crash — find culprit in share modal chain
6. **N-D: instance-stats wiring** (module + InstanceStat model ARE STAGED at
   `modules/instance-stats/` + `app/src/models/InstanceStat.mjs`; remaining: vendor
   Plotly to `services/web/public/` (zero runtime downloads), "Dashboard" menu item
   in `account-menu-items.tsx` ManageMenu + navbar Admin dropdown (flag
   `canDisplayInstanceStats` from ol-navbar meta), settings block `instanceStats
   {enabled, retentionDays}` in SiteSettingsManager + /admin/site UI, cron files
   (image already runs `runsv cron` + /etc/cron.d) + Dockerfile ADD, i18n keys
   (en.json + extracted-translations.json), tests, build, E2E verify dashboards)
7. G3 (admin API) + G6 (bib) sweeps → BUGHUNT_ROUND2_REPORT.md
8. commit + push (N-1/N-B2/N-2/N-F/N-C/N-D + Makefile + Dockerfile + package +
   instance-stats + models + page-shells)
