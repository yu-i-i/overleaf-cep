# Plan: ORCID picker · bib-editor fixes · templates

Branch: `bib-editor` (origin `davrot/overleaf-cep`) — checkout `/root/junk_bib/overleaf-cep`
Status: FINAL v4 (2026-08-28) — all open decisions agreed by the user (2.2 zip + pdf-optional, 2.3 ORCID semantics, 2.4 stray string confirmed, 3a publish fields, 3c encrypted secrets, 3d SSRF implementation). Executing: **P0 ✅ → P1 ✅ → P2 ✅ → P3 ✅ (admin console; deployed+verified, committed b61b63e72b, round-3 feedback applied: rename /admin/site → "Manage Extensions" + /admin/user chrome, working "Manage" sub-dropdown with Manage Site→/admin / Manage Extensions→/admin/site / Users / Projects, **+ round-4/5 feedback applied: inline Manage accordion (chevron ">"), /admin/site left sidebar, all-categories template table, stacked textarea labels, Save-changes 400 FIX (double-stringified body), /register renders for logged-in admins, env seeds removed from compose.yaml → fully settings-driven)** (2026-08-28). User feedback round 1 captured (§4.5: READMEs, `__count__` i18n fix, nav restructure, blank-page fix; **P4 Zotero picker = NEXT PHASE**).

### Progress log (verified)

### 2026-08-28 (night) — P4 Zotero picker + P3 extras (3a/3b/3d/3e) + New 1–4 implemented
**P4 — Import from Zotero (user's linked Zotero, same UX as the ORCID picker):**
- Server (`modules/zotero`): `ZoteroApiClient` picker methods (libraries = main library +
  groups; collections; items newest-first; combined BibTeX for selected keys, capped at
  200 keys — one Zotero request). `ZoteroController` 4 handlers; `ZoteroRouter` GET
  `/user/zotero/picker/{libraries,collections,items,bibtex}` (login + `ensureZoteroEnabled`;
  unlinked → 409 `zotero_not_linked`).
- Frontend: `zotero-picker-modal.tsx` (library + optional collection → Browse → item
  table with select-all → Import selected). Wired into the Add menus of both hosts
  (`bib-entry-list.tsx` `onAddFromZotero` prop; `bib-editor-panel.tsx` + `library-page.tsx`
  state + modal; insert reuses the existing guarded BibTeX import path).

**3a — per-category publishable:** Templates table gains a Publishable checkbox per
category; `TemplateAuthorizationMiddleware` create-branch: explicit per-category
`publishable` (stored, admin-managed) overrides the legacy
`OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES` (true → allowed, false → 403); bundle import
enforces it too (non-privileged importers).

**3b — template bundle save/import:** bundle = `template.json` + `source.zip` + optional
`output.pdf`. `GET /template/:id/bundle` (management access) assembles from the
filestore (`/template/{id}/v/{n}/zip|pdf`) via archiver; `POST /template/bundle/import`
(base64 zip; name conflict → 409 + optional override → version bump) reads via yauzl,
re-uploads assets, 3a category check. Admin UI: Manage Extensions → Templates →
"Template bundles" (list + Download bundle + Import bundle… with conflict confirm).

**3d — external-URL SSRF guard:** `UrlPolicy.mjs` (pure `ipToBigInt`/`ipInCidr`/regex
match, fails closed on a broken admin regex) + `getSection('externalUrl')` policy
applied in `UrlAgent.createLinkedFile` before fetch AND on every manual-redirect hop
(≤5) — `fetchWithPolicyRedirects` (node-fetch `redirect:'manual'`). Unit-tested.

**3e + New 1 — Sign Up section:** registration on/off (admin console), allowed email
domains (enforced per-request in `RegistrationPageController`; stored ∪ env seed), and
NEW `signup.disabledRedirectUrl` — when signup is disabled, GET `/register` 302-redirects
to it (default `/login`), POST stays 403.

**New 2 — Duplicate in the file tree (all file types):** `EditorHttpController.duplicateEntity`
+ route `POST /project/:Project_id/:entity_type/:entity_id/duplicate`: text files
(defaultTextExtensions → doc/docstore) copy via `EditorController.addDoc`; binaries
(`fileRef`) copy the filestore blob via `ProjectEntityUpdateHandler.duplicateFile`
(`createdBlob:false`, no re-upload) + `reciveNewFile` socket emit. Name chain
`a.b → a_copy.b → a_copy(1).b` (pure `generateDuplicateName`, unit-tested). Frontend:
`canDuplicate`/`duplicateSelected` in `file-tree-actionable.tsx`, `syncDuplicate` in
`sync-mutation.ts`, "Duplicate" menu item directly below Rename.

**New 3 — Templates switcher sub-items:** `GET /api/template/categories` (enabled
admin-managed categories) → `ds-nav-page-switcher.tsx` renders an expandable Templates
sub-item list under the switcher (first click expands, second navigates).

**New 4 — category Edit modal:** description textarea width = name input width
(`w-100` + inline `width:100%`).

**Validation:** eslint `--max-warnings 0` on every touched file ✓; vitest: site-settings
(13), duplicate-name (5), url-policy (7) + bib-editor (incl. i18n) + LinkedFiles —
433/433 ✓. Build + live verification follow.

### 2026-08-29 (evening) — R5 bug fixes + R6 feedback round (10 items)
**R5 (done this session):**
- Binary (jpg) "Duplicate of binary files" 500 → `duplicateFile` now exposed in
  `ProjectEntityUpdateHandler.promises`; `duplicateEntity` file branch builds a
  fresh `new File({name, hash, linkedFileData})` and calls it (no re-upload;
  same filestore blob, new entity `_id`).
- "I don't see the template save function" → "Download bundle" button added to
  the template detail page (owner/admin block) beside Edit/Delete.

**R6 (10 items, user 2026-08-29):**
1. **Preview 500 without compiled PDF** — `fetchTemplatePreview` now returns a
   neutral document-style SVG placeholder (`image/svg+xml`) when the filestore
   asset is missing and `isImage`; non-image failures → 404 (not opaque 500).
2.+4. **`/templates` header compact** — `gallery-header-all.tsx` rewritten:
   only the `LaTeX Templates` title (eyebrow/summary removed; no top spacer);
   the **self-referential** "Template Gallery" back link on `/templates` itself
   removed (`gallery-search-sort-header.tsx` renders a spacer instead).
3. **`.previous-page-link` dark-mode invisible** — now theme-aware
   (`var(--ds-color-text-primary)` + `[data-theme='default']` override to
   `var(--neutral-10)` in `components/link.scss`).
5.+9. **Import templates from file OR external URL for template admins** —
   - `POST /template/bundle/import-url` — SSRF-guarded: `UrlPolicy` allowed-
     resources regex + blocked CIDR networks, each redirect hop re-checked
     (`UrlAgent.fetchWithPolicyRedirects`), 9 MB download cap, empty-body check.
   - **Rich pre-validation** (all issues collected BEFORE anything is added,
     422 + `{ issues: [...] }`): not-a-zip, missing template.json/source.zip,
     invalid/non-object JSON, missing/oversize name, missing/unknown/disabled
     category (lists known keys), non-privileged publishable=false, mainFile
     absent from the inner source.zip (real entry listing via new
     `_bundleZip.listZipEntryNames` — the 3-name `readZipEntries` can't be
     used for the inner zip), bad PDF magic, size caps. UI renders the list
     item-by-item ("fix the following and try again").
   - Category stored canonically as `/templates/<key>` (matches gallery
     queries) — imported templates now appear in their category pages.
   - **`/templates/manage`** page (login + management access; works WHILE the
     public gallery is disabled) with the shared bundles UI: list (new admin
     endpoint `GET /api/templates/admin-list` — NOT gated by
     `ensureGalleryEnabled`; the old `/api/templates` 404'd when the gallery
     was off, which broke the admin console bundle card), per-template
     Download bundle, Import from file, Import from URL + rich feedback.
   - Admin console (`/admin/site` → Templates): local 3b `TemplateBundles`
     replaced by the shared component (same surface, + URL import, + issues
     list).
6. **Edit-template Category select** — `settings-template-category.tsx` now
   fetches `GET /api/template/categories` (real site categories) instead of
   the env-seeded `ol-ExposedSettings.templateLinks` (only "All templates").
7. **Admin console → Templates: users table** — new
   `GET /admin/site/template-admins` (site admin) + `TemplateAdminsTable`
   (name/email + per-user Revoke shortcut).
8. **`/admin/user` Create + Update account modals** — "Template gallery
   admin" checkbox → `flags.canManageTemplates` on the user (new
   `UserSchema.flags.canManageTemplates`); `registerNewUser`/`updateUser`
   accept `canManageTemplates`; `_formatUserInfo` returns it.
10. **`/admin/site` → Templates: "All users are template gallery admins"** —
   new `SiteSettings.templates.allUsersCanManageTemplates` (stored wins over
   env seed `false`); admin console checkbox.

**Role design (5/9/10):** template gallery admin = distinct scoped role
(`flags.canManageTemplates` per user, OR `allUsersCanManageTemplates` site
setting, OR legacy `Settings.templates.user_id`, OR site admin). Centralized
in new `TemplateAuthorizationHelper.hasTemplateAdminAccess(user, userId)`;
`TemplateAuthorizationMiddleware`, `importTemplateBundle*`,
`canUserOverrideTemplate`, and both `userIsTemplatesManager` metas now use
it. Template admins can manage templates (create/edit/download/import)
WITHOUT full site-admin powers.

**Zotero OAuth start fixed** (P4 leftover): `Settings.zotero` is undefined in
this deployment (no `ZOTERO_*` env) so `getRequestToken()` threw
`TypeError → 400`. `ZoteroOAuth.getCredentials()` now resolves site_settings
`zotero` section (clientSecret decrypted by the manager) with env fallback
and a clear 503 when unconfigured; `oauth_callback` derived from the request
origin. `ZoteroController.oauth` passes credentials + callbackURL.

**Testing:** new `modules/template-gallery/test/unit/src/bundle-validation.test.mjs`
(8 tests) covers: missing entries, bad JSON, valid accepted,
`/templates/<key>` normalization, unknown category + known-key hint,
multi-issue report (name length + mainFile + bad PDF), publishable
(non-privileged) vs privileged bypass, 422 error shape.

**Validation:** eslint `--max-warnings 0` on all touched TS/TSX ✓ · vitest
481/481 (twice, combined run) ✓ · `node --check` on every touched .mjs ✓.

### 2026-08-29 — fixes from live verification + final deploy; **33/33 live checks PASS**
- `672c3d12be` — 3d fix: `assertUrlAllowed` was ignoring the boolean from
  `matchesResourceRegex` (allowlist never rejected anything). Now enforces.
- `652c24ce13` — crash-loop fix: `RegistrationPageController` had a TS type
  annotation in a `.mjs` runtime module (SyntaxError on boot).
- `fc95490f2f` — two verification failures fixed correctly:
  - **Duplicate endpoint 404**: file-tree entities in this CE build are stored
    **inline on `project.rootFolder`** (the `folders` collection is empty), so
    `duplicateEntity` now walks `project.rootFolder` instead of
    `Folder.findById` (helper `_findEntityInProject`).
  - **SSRF guard 403s surfaced as 500**: added `UrlPolicyDeniedError`
    (LinkedFilesErrors, thrown by `UrlPolicy.assertUrlAllowed` for allowlist
    mismatch + blocked CIDR), rethrown as-is by `UrlAgent` (not wrapped into a
    422 `UrlFetchFailedError`), and mapped to **HTTP 403** in
    `LinkedFilesController.handleError` (previously fell to the global 500).
  - url-policy tests now pin the error class + `info.status=403` (11 tests).
- Deploy: image `bib-editor` @ `fc95490f2f`, container cycled healthy.
- **LIVE VERIFICATION (2026-08-29, FQDN, CDP headless, fresh profile):
  33/33 PASS** across: admin console (5 tabs incl. Publishable column +
  bundles UI + Sign Up fields, Save ok) · /register enabled/disabled/
  custom-redirect/POST-403 · 13 categories (Theses managed) · file-tree
  Duplicate (menu below Rename; server 200 `main_copy.tex`; copy visible) ·
  Zotero picker (409 not-linked + menu item + modal + Link action) · bundle
  round-trip (create → 409 conflict → override v2 → listed → download zip with
  template.json/source.zip/output.pdf → content match → delete 200) · SSRF
  guard (loopback 403, non-allowlisted host 403) · category modal textarea
  width == name width.
- Unit tests: 473/473 (url-policy 11, duplicate-name 5, site-settings 13,
  LinkedFiles, bib-editor, orcid-picker). Lint clean. All 5 commits pushed to
  `origin/bib-editor` (`d21990b559` → `fc95490f2f`).

### 2026-08-29 (night) — R7 (7 items) + R8 (3 items) feedback rounds
**R7 (user 2026-08-29):**
1. **Zotero picker items 500** — `ZoteroApiClient.getItemsForPicker` destructured
   `fetchJsonWithResponse` as `{ body }`, but that helper returns `{ json }`
   (string helpers return `{ body }`) → items silently `undefined` → later
   `.map` crashed (500). Fixed to `{ json: items }` + non-array guard.
2. **Divider between /project + /library bib panels** — preview panel border
   raised to `--bib-panel-divider` (neutral-60 dark / neutral-40 light).
3. **Entry-type double arrow** — `DropdownToggle` got `no-default-caret`
   (keeps the single custom `keyboard_arrow_down`).
4. **Visual→Code: entry at top with cursor** — root cause: the panel is
   UNMOUNTED on the code switch, so the `showVisual` watcher effect never ran
   (effects don't run for removed children). Flush + reveal moved to the
   unmount cleanup (idempotent with watchers; 'new' entries scroll to doc end).
7. **Entry card arrangement** — key row first (with dup/error icons), then
   title, author, year (both card layouts; reviewer reference match).
5. **/templates/manage `useSplitTestContext`** — already fixed
   (`SplitTestProvider`) in the R6 follow-up; re-verified.
6. **Update-account modal + Template gallery admins table** — see R8.2 (the
   real symptom was the empty name cells).
8. **User settings missing the Zotero connector** — the widget gate
   (`ExposedSettings.zoteroEnabled`) only saw env `Settings.zotero` (unset in
   this deployment). Now also seeded from stored site_settings at module boot
   (`modules/zotero/index.mjs`) + fallback to `enabledLinkedFileTypes` in
   `ExpressLocals`. Link/unlink (API key + OAuth) visible again at
   `/user/settings`.

**R8 (user 2026-08-29):**
1. **Picker "Browse items" empty (no error)** — same `{ body }` vs `{ json }`
   bug as R7.1 (the 500 had only shown before the half-applied fix); with the
   fix, `/user/zotero/picker/items` returns real items (30 in My Library, 32 in
   the group `graduiertenkolleg_...`) and the modal lists them; BibTeX
   selection export unchanged.
2. **Template gallery admins: names missing** — API returned
   `firstName`/`lastName` but the table rendered `u.name` (always empty).
   Component now renders `firstName + lastName` (both users visible with
   names). Revoke round-trip verified through the live Revoke button.
3. **/templates/manage left "nav bar"** — added the same ds-nav page
   switcher chrome as /templates (Library / Projects / Templates active +
   lower section with theme toggle + account).

**Verification:** lint 0 (all touched files), 481/481 unit tests (twice),
build `server-ce make all` → cycled `overleafserver` → live DOM checks all
PASS (picker items user+group, divider 1px, single caret, card order
key→title→author→year, visual→code selection at entry, admins names, manage
nav, /user/settings widget, /templates/manage render). Smoke template-bundle
test templates (3 × "Bundle Smoke *") deleted from Mongo.

### 2026-08-28 (evening) — user round-4 + round-5 feedback applied (items 1–7)
**Round 4 (menu + sidebar):**
- Manage menu: replaced the broken react-bootstrap nested flyout with an
  **inline accordion** (`ManageMenu` in account-menu-items.tsx): `CaretRight` (">")
  that rotates 90° when open (`.manage-menu-caret.is-open`), items render as
  inline `a.manage-menu-link` (no popper/portal → cannot be clipped or
  swallowed by the parent root-close). Verified live: 4 links, correct
  naming/URLs (Manage Site→/admin, Manage Extensions→/admin/site,
  Users→/admin/user, Projects→/admin/project), chevron class toggles.
- /admin/site: added the `/admin/user`-style **left sidebar**
  (`.user-list-sidebar-wrapper-react` + section `ul.user-list-filters`
  buttons for Templates/Zotero/External URLs/Sign Up +
  `.ds-nav-sidebar-lower` account & CE+ block); h1 = active section label;
  top button row removed. Verified live.

**Round 5 (items 3–7):**
- (3) Templates table now lists **all** supported categories: seed = 12
  manual defaults ∪ env categories ∪ 'all'; `getSection` already merged
  stored ∪ seed per key (stored wins per key). Result: 13 rows incl.
  Books/CV/Poster/Newsletter/Bibliographies/… — verified live.
- (4) Textarea labels sit **above** the field (`d-block mb-2` on the two
  textarea `OLFormLabel`s; geometry-verified stacked: label bottom 248 <
  textarea top 256).
- (5) **"Save changes" 400 fixed — root cause:** the page double-stringified
  the JSON body (`putJSON(..., { body: JSON.stringify(body) })` while
  fetchJSON stringifies again) → body-parser
  `SyntaxError: ""{"enable"... is not valid JSON` → 400. Now passes the
  object. Verified: all four tabs save via REAL DOM clicks → "✓ Saved".
- (6) /register: removed the logged-in redirect in
  `RegistrationPageController.registrationPage` (was `req.user →` redirect
  `/` → /project — the user's exact symptom); POST still refuses to create
  an account under an active session. Verified: logged-in admin → 200
  sign-up page. (Anonymous /register on this site goes through the
  standard login wall — `!allowPublicAccess` + SSO deploy; unchanged.)
- (7) compose.yaml: removed OVERLEAF_TEMPLATE_GALLERY, OVERLEAF_TEMPLATE_CATEGORIES,
  TEMPLATE_*_NAME/DESCRIPTION (×3 pairs), ZOTERO_CLIENT_KEY/SECRET after
  migrating the Zotero secret into the stored `site_settings` doc
  (encrypted at rest). Server force-recreated; verified with NO env: templates
  13 cats + names, zotero enabled + secretSet, signup on, externalUrl kept,
  /register 200, /templates 200.
- Unit tests: made hermetic — tests now use a dedicated Mongo db
  (`MONGO_URL` → `site-settings-unit`, MONGO_URL is the supported override
  in config/settings.defaults.js) so the LIVE stored settings can no longer
  leak into env-seed assertions (that leak had started failing 3 tests);
  fixed `to.have.members` chai assert + stray spread; 12/12 green.
- **Open (P4, planned):** Zotero picker (same UX as ORCID picker, source =
  user's linked Zotero via modules/zotero API).

### 2026-08-28 (later) — P3 verified, committed, and round-3 feedback applied
- **P3 live verification (final):** 26/27 checks PASS on the FQDN (admin
  console page + 4 tabs; category rename/persist round-trip; gallery
  OFF→404 / ON→200; Sign Up ON/OFF persistence; Zotero OFF→403 with
  status endpoint open; External URL 422 validation ×2 + valid persist;
  Edit modal opens name/description; **non-admin blocked** — page →
  `/restricted?from=/admin/site` (core admin guard) + 12/12 unit tests).
  The single "FAIL" was harness session-stickiness (test browser kept a
  prior login) — not a product gap.
- **Committed + pushed:** `b61b63e72b` (36 files, +2171/−125; credential
  scan clean).
- **User round-3 feedback (applied this pass):**
  1. `/admin/site` renamed **"Manage Extensions"** (i18n
     `manageExtensions`, page title, controller title);
  2. its page chrome now **identical to `/admin/user`** (DS-nav:
     `user-ds-nav-page` + `red-nav-bar-for-admins` + `DefaultNavbar` +
     `user-list-wrapper` + `user-list-title`; `suppressNavbar = true`
     in the pug, React renders the navbar);
  3. **working "Manage" sub-dropdown** in the Account menu (left flyout,
     hover/click, Esc/outside close) with: **Manage Site → `/admin`**
     (the existing System Admin Panel, historical name per user),
     **Manage Extensions → `/admin/site`**, **Manage Users →
     `/admin/user`**, **Manage Projects → `/admin/project`** — the
     earlier flat label (and before that, a nested react-bootstrap
     `<Dropdown>`, broken by the parent's root-close) is gone;
  4. `/register → SSO` nginx 301 removed from
     `/data_1/docker/compose_cep/nginx/nginx.conf`; nginx cycled;
     local login flow verified (`/register → /login`);
  5. docs updated (admin-tools README, SiteSettings README, this plan).
- **Next: P4 — Zotero picker** (ORCID-picker clone; source = linked
  Zotero via the zotero module; gated by Manage Site → Zotero).


  mapping now a tested pure `helperKeyForField` (`utils/bib-form-helper.ts`,
  4 unit tests); key dropped from `en.json` + `extracted-translations.json`.
  Gates: eslint 0 warn, vitest 424/424, image `bib-editor-5c6dacf…` built
  (stray string absent from bundle), container cycled healthy (image-ID match,
  /tmp 1777, port 4000), **live-verified**: project form (greenwade93 → Author
  row has no helper) + library Add→"Enter manually" (Author row no helper),
  `strayOnPage=false` on both. Committed `011b72458a` (code) + `08b50ebc96`
  (this plan), pushed to origin/bib-editor.
  - Note: root `yarn install` was required (known-broken lockfile; sanctioned
    ~4.7k-line prune committed with P0; `yarn install --immutable` passes).
  - i18n pipeline follow-up (LOW, separate task): scanner glob
    `modules/*/frontend/js/**` misses modules without `js/` (reference-picker,
    symbol-palette) and drops some TSX `t()` calls → regenerating
    `extracted-translations.json` now removes 797 keys (773 stale, 24 still used
    incl. bib-editor strings + `Page range` helper). Do NOT regenerate until the
    scanner config/transform is fixed + the 24 re-added (list obtainable via a
    key-diff of the scanner output vs HEAD file).
- **P1 DONE (2026-08-28)** — deployed build now = current tree + P0.
  (initial repro-harness notes below; final state: see “P1 ROOT CAUSE …
  FIXED + VERIFIED” section + commit `367716de94`.)
  Repro harness: CDP driver `/tmp/oly-e2e/cdp.mjs`; open entry = click
  `.bibtex-entry-card-clickable` (role=button, id `bibtex-entry-card-<key>#0`);
  list = `.bibtex-entry-list-body [data-index]`; panel = `bib-editor-panel` /
  `bibtex-list-and-preview` (a CM6 `cm-panel` under `.cm-panels`); Visual mode =
  "Visual" span near editor; project `sample.bib` entry `greenwade93` = baseline.
  Open: identify the save control for the project form (no Check/Save button
  inside `#bibtex-entry-form`; footer likely in panel toolbar) before the
  reviewer-sequence repro (edit author → save → main.tex → back).

  **2026-08-28 update — REPRODUCED (3×) + ROOT CAUSE identified + fix designed:**
  Sequence (live TestProject/`sample.bib`, entry `greenwade93`): Visual → open
  entry → type new author into `#bib-field-author-0` (flush fires on the file
  switch — `bib-editor-panel.tsx` leave-watcher; spy: exactly ONE
  `bib-editor:write`, zero `write-failed`) → click main.tex → click sample.bib →
  **list shows the entry TWICE** (both rows with the new author). **Server truth
  (fresh load) = exactly 1 entry with the new author** after every repro run →
  server is correct; corruption is client-side only. Console (`?debug=true`):
  `[inflightOpTimeout] Sending` ×N, `aborted`, `Received an ack for an op with
  an outdated version.` ×3, `pollSavedStatus: assuming not saved` forever (op
  never acked) → reviewer's 'Out of sync' on next interaction; reload → 1 entry.
- **P2 DONE (2026-08-28)** — ORCID picker ported from `../old-doi-orcid-picker`
  @ e3c75ff into `modules/orcid-picker/` (router + hardened service + modal) and
  wired into BOTH Add menus (project bib panel + library top bar) as
  “Import from ORCID.org”. Service hardening vs old: hop-by-hop SSRF
  (`redirect:'manual'` loop + strengthened `isPrivateAddress` incl. IPv4-mapped
  IPv6, ULA, CGNAT, link-local), 5-hop cap, 10 s timeout, 2 MB cap, DOI key
  sanity filter. Modal: i18n (28 new en.json keys + 2 extracted-translations
  keys), OLFormCheckbox, import worker pool (4) with live progress, local ORCID
  format validation. Import adapters normalise citation keys (`normaliseOrcidEntryKeys`
  + tests — ORCID-embedded BibTeX can carry illegal URL-style keys; the library
  REST rejects those, the all-or-nothing project import rejects any batch with a
  taken key — both verified as the correct product semantics). Verified live:
  project 1→3 rows (works #1+#2), name-search flow, invalid-iD local error,
  library +1 row, 0 significant console errors, UI=mongo agreement; test data
  cleaned (bad URL key → `haak2025`, probe author → George D. Greenwade).
  Gates: orcid unit 9/9, bib-editor 429/429, scoped eslint 0 (autoFocus +
  floating-promise rules fixed), build (2 webpack path-depth errors caught:
  `../../` → `../../../../` cross-module import), image `2a1eabb2…` (routes
  302-not-404, strings in bundle), cycled healthy. Remaining for P2 scope:
  none (templates zip/PDF publish = separate P3-adjacent items tracked below).
- **P3 IN PROGRESS (2026-08-28)** — 3.0 admin foundation + 3a Manage Site shell:
  New core feature `app/src/Features/SiteSettings/`:
  - `SiteSettingsManager.mjs` — one site doc `{_id:'global', templates, zotero,
    externalUrl, signup, updatedAt}` in `site_settings` (raw collection added to
    `app/src/infrastructure/mongodb.mjs`); 5 s TTL cache + in-flight dedupe;
    stored-wins-over-env (env = seed); per-request accessor (multi-worker safe);
    `DEFAULT_TEMPLATE_CATEGORIES` = the 12 manual example categories (+ 'all'
    implicit); masked-secret GET; validators per section; LAZY db import (safe
    in test envs). `SecretCipher.mjs` — same cipher family/file/label as
    zotero/github-sync `AccessTokenEncryptorHelper` (API: `encryptJson` /
    **`decryptToJson** — note: `decryptJson` does not exist).
  - Admin API: `modules/admin-tools/app/src/SiteSettingsController.mjs` + routes
    `GET /admin/site`, `GET /admin/site-settings` (masked + per-category
    `Template.countDocuments` counts), `PUT /admin/site-settings/:section`
    (validated; secret '' = keep) — all under `ensureUserIsSiteAdmin`.
  - De-bootgates: template-gallery (always registered; `ensureGalleryEnabled`
    404s every gallery route when off; per-request categories in
    `ExpressLocals` res.locals + `getTemplatesPageData`), zotero (always
    registered; `ensureZoteroEnabled` 403 on link/groups endpoints + create-file
    gate in `LinkedFilesController`; unlink stays open), registration-page
    (always registered; `ensureRegistrationEnabled` 404/403 on /register).
  - Manage Site UI (admin-tools module): `manage-site-react.pug` +
    `pages/manage-site.tsx` + `site-settings/` component with 4 tabs
    (Templates table: name link/on-off/count/description/Edit modal (name+desc)
    per user design + gallery on/off; Zotero key+masked-secret; External-URLs
    CIDR list + regex; Sign Up on/off + domain allowlist). ~26 new i18n keys by
    hand in en.json + extracted-translations.json (not regenerated).
  - Tests: `test/unit/src/site-settings.test.mjs` 12/12 (validators, defaults,
    masking, env seeds, cipher round-trip); PLUS fixed a PRE-EXISTING syntax
    error (unbalanced brace since commit 463e4d5034 #164) in
    `test/unit/src/LinkedFiles/LinkedFilesController.test.mjs` + aligned its
    final assertion with the implementation (error is thrown BY the agent
    refresh call → `calledOnce`).
  - Gates: scoped eslint 0 warn; linked-files+site-settings 16/16; FULL-SUITE
    A/B: clean baseline 22 failed files / 215 failed tests vs WITH changes
    21 failed files / 215 failed tests — ZERO new failures; the only file
    delta is LinkedFilesController.test (broken in baseline, fixed by us);
    the 215 pre-existing failures are Settings-less test-env issues in
    untouched core suites (Project/User/Subscription/...).
  - TODO next: lint test file, build (`make all`), cycle container, live-verify
    (admin page, gallery on/off, category edit, persisted doc, registration &
    zotero gates), commit + push; then 3b/3c/3d/3e.

## 4.5 User feedback round 1 (2026-08-28, on the live admin console + orcid picker)

Items as reported by the user (executing; see progress log):

1. **Plan updated** — this section.
2. **READMEs** — written/updated: `modules/orcid-picker/README.md`
   (new), `modules/zotero/README.md` (new), `modules/registration-page/README.md`
   (new), `app/src/Features/SiteSettings/README.md` (new),
   `modules/template-gallery/README.md` + `modules/admin-tools/README.md`
   (extended with the SiteSettings/de-bootgate + Manage Site entries).
3. **P4 — Zotero picker (NEW PHASE, user-directed)**: same UX as the
   ORCID picker (search/works/select/import into project `.bib` and
   library), but source = the user's LINKED ZOTERO account via the
   existing `modules/zotero` API surface (`ZoteroApiClient`
   works/collections items, `?format=bibtex`), admin-gated by the
   existing Manage Site → Zotero on/off. Reuse `splitImportText` +
   `normaliseOrcidEntryKeys`, the Add-menu wiring, and the modal
   design language. Phases: 4.1 API endpoints (list collections, list
   works w/ pagination, fetch bibtex by keys) under the zotero module;
   4.2 `zotero-picker-modal.tsx` + Add-menu entries on both surfaces;
   4.3 tests + lint + build + live-verify + commit/push.
4. **ORCID modal `{{count}}` bug (FIXED)**: this codebase's i18next
   uses `__var__` interpolation (`frontend/js/i18n.ts` prefix `'__'`),
   not `{{var}}` — the works sub-modal rendered literal `Select all
   ({{count}})` / `Import selected ({{count}})`. Converted the 4
   affected keys (en.json + extracted-translations.json) and the
   modal's `t()` calls to `Select all (__count__)`,
   `Import selected (__count__)`, `Importing __done__ of __total__…`,
   `Works — __author__`. LESSON: always use `__var__` in i18n strings
   in this tree.
5. **Nav restructure (user-directed)** —
   a) header navbar: **Admin management block removed**
      (`admin-menu.tsx` no longer renders Manage Site/Users/Projects;
      `default-navbar.tsx` hides the Admin dropdown when no
      admin/dev items apply — dev flags unchanged);
   b) **Account dropdown** (`account-menu-items.tsx`): new **Projects**
      entry (→ `/project`) directly above Library; the Manage* links
      grouped under a “Manage” section label (Manage Site →
      **`/admin/site`** — the previously dead `/admin` link is gone,
      Manage Users → `/admin/user`, Manage Projects →
      `/admin/project`); dev-only items kept flat. NOTE: the first
      attempt used a nested react-bootstrap `<Dropdown>` inside the
      menu's `Dropdown.Menu` — the parent's root-close handler swallows
      the inner toggle (broken, reported by the user) → switched to a
      disabled label + flat items (proven pattern of this menu).
6. **Blank `/admin/site` page (FIXED)**: `site-settings-root.tsx` used
   `withErrorBoundary(Fallback)(Component)` but this tree's signature
   is `withErrorBoundary(Wrapped, Fallback?)` (see
   `frontend/js/infrastructure/error-boundary.tsx`) → module-init crash
   `(0, a.A)(...) is not a function`. Now
   `withErrorBoundary(SiteSettingsRoot, () => <GenericErrorBoundaryFallback />)`.
   Audit rule: check the ACTUAL export/arg convention of shared helpers
   before use (manage-users-root is the reference implementation).

### P1 ROOT CAUSE (code-verified; FIXED + VERIFIED 2026-08-28)

Protocol: vendor `services/web/frontend/js/vendor/libs/sharejs.js` +
`services/real-time/app/js/DocumentUpdaterController.js`:
1. `submitOp()` applies the op to the local snapshot WITHOUT advancing `version`
   (`flush()` sends `v: this.version` pre-increment; version only advances in
   `_onMessage` on ack/remote-apply).
2. Server applies once (mongo content proves it) and acks the SENDER with pure
   `{v, doc}`; the full op goes to collaborators — EXCEPT a `dup`-marked op
   (resend already applied): controller comment: "Duplicate ops should just be
   sent back to sending client for acknowledgement" → **sender receives its own
   op back** (`client.emit('otUpdateApplied', update)`).
3. Client own-op branch (`sharejs.js:1094`) requires
   `inflightSubmittedIds.includes(msg.meta.source)` — but that list is only
   pushed in `_connectionStateChanged('disconnected')` (~line 977), never on a
   normal send. A mid-op socket/session churn (observed `aborted` = transport
   abort/reconnect → new session id) → server-recorded `meta.source` (old
   session) ∉ list → **dup echo misroutes to the REMOTE-OP branch (~line 1230)**:
   `msg.v === this.version` still passes; `_xf(inflightOp, op)` self-xform
   keeps BOTH inserts → **op applied a 2nd time locally** (duplicate entry,
   `version++`).
4. The true pure-ack then arrives `v < this.version` → "ack for an op with an
   outdated version" → **discarded** → `inflightOp` never cleared → endless
   `[inflightOpTimeout] Sending` + `assuming not saved` (dead state).
5. Next state rebuild shows the corrupted snapshot (2 entries); next edit hits
   the desynced version state → Out of sync modal; reload restores server truth.

**Fix (minimal, vendor file — already carries Overleaf modifications):** extend
the own-op branch condition at `sharejs.js:1094`: if `this.inflightOp` is set,
`msg.v === this.version`, and the incoming op deep-equals `this.inflightOp`
→ treat as own-op ack (reuse existing ack path: clear inflight, callbacks,
`delayedFlush()`), plus a debug log when the rescue fires. GATES: CDP repro →
1 entry / saved / no outdated-ack warn / no resend loop; plain-edit sanity; two-
session collab sanity; eslint (scoped, 0 warn); bib-editor vitest 424/424;
`make all` + cycle + live verify both surfaces; commit+push. Regression
artifacts: move the CDP repro scripts from /tmp into the repo (scripts/ or the
bib-editor module test dir) as the standing repro/test.

**FIX APPLIED** (`frontend/js/vendor/libs/sharejs.js`): the own-op branch
condition (the `msg.op === undefined …` line) is extended with
`|| isOwnOpEcho(this, msg)`; helpers `sameOpJson()` (safe deep JSON
equality) + `isOwnOpEcho()` (requires a live unacked `inflightOp`, matching
`msg.v === this.version`, and content equality) route the dup echo into the
existing ack path (clears inflight, callbacks, `delayedFlush()`), with an
always-on debug warn when the rescue fires.

**VERIFIED (2026-08-28, deployed image `bib-editor` = `e05d63b1…`):**
- RED baseline (pre-fix build): repo regression test FAILED exactly as
  predicted — entry duplicated (2 rows), 2× `ack … outdated version`, 2×
  `[inflightOpTimeout] Sending`, op left un-acked.
- GREEN (fixed build): **11/11 checks PASS (twice)** — one entry, new author
  present, 0 outdated-ack discards, 0 resends across the 5s watchdog
  window, final `pollSavedStatus: no inflight or pending ops` (saved), no
  Out-of-sync modal.
- Collab sanity (two sessions): B ran the reviewer sequence while A held
  the file — A sees exactly the single updated entry; B's console clean.
- GATES: eslint 0 warn (scoped; vendor file eslint-ignored by design),
  bib-editor vitest 424/424, `make all` clean, container cycled healthy
  (image-ID match, /tmp 1777, port 4000), rescue string present in the
  served bundle, live-verified on the FQDN (testjoe).
- Regression artifact now in the repo:
  `services/web/modules/bib-editor/test/e2e/` (cdp.mjs driver +
  out-of-sync-repro.mjs + README) — env-only credentials, exit 0 on pass.
- Server dedup was never at fault (mongo content = 1 entry after every
  repro run); the fix is entirely in the vendored sharejs client. Residual
  (out of scope, low): a genuine two-user identical-op race could in theory
  be classified own — content-identical, invisible no-op.

---

## 0. Current state (verified in this tree / live container)

**Layout (this tree — reorganized CE):**
- Web app: `services/web/{app,frontend,modules,config}`. `services/web/app` = `src/`, `templates/`, `views/` (templates live in `services/web/app/templates/` → `plans/`, `project_files/`).
- Modules: `services/web/modules/<name>/{app/src/*.mjs routers, frontend/js/{components,context,utils,pages}, index.mjs}`.
- Module registration: `services/web/config/settings.defaults.js` — `moduleImportSequence` (backend routers, e.g. `'template-gallery'`, `'git-bridge'`), `sourceEditorExtensions`, `visualEditorProviders`, … (bib-editor is already registered: `sourceEditorExtensions: [bib-editor-extension.ts]`, line ~1080).
- `AuthenticationController` import path used by current modules (admin-tools, bib-editor `LibraryRoutes.mjs`): `../../../../app/src/Features/Authentication/AuthenticationController.mjs` — i.e. the **old orcid-picker router imports are layout-compatible with this tree** (verified).

**bib-editor (project + library surfaces):**
- File is truth (R2): CodeMirror document is the source of truth. `bib-editor-extension.ts` re-parses the doc on change (300 ms debounce) and emits `BIB_ENTRIES_EVENT` (`entries`, `source`, `isBibFile`, `written?`). `bib-editor-provider.tsx` bridges events → React context (`setEditorState(isBibFile, entries, source, written)`). Writes are guarded pure plans in `bib-write.ts` (`planBibWrite/planBibDelete/planBibBulkDelete/planBibImport`, guards: `key-taken`, `not-a-bib-file`, `entry-gone`, clamp-on-stale-range).
- Components: `bib-editor-panel.tsx` (list + toolbar + write-failure banner "Could not save: the file changed or is no longer a bibliography."), `bib-entry-list.tsx` (Add dropdown: Paste references [BibTeX, DOI] / Enter manually / Import-from-Library stub — C5/C9), `bib-entry-form.tsx` (shared form, kinds `new`/`edit`/`inplace`), modals `bib-manual-modal.tsx` / `bib-import-modal.tsx` / `bib-import-from-library.tsx`.
- Library: `frontend/js/library/*` (`library-page.tsx`, `library-context.tsx`, `library-api.ts`) + backend `app/src/LibraryController.mjs` (409 on duplicate key), `LibraryRoutes.mjs`.
- Library feature flag pattern exists: `OVERLEAF_BIB_LIBRARY` (settings.defaults.js:847 comment).
- **Stray string (point 2) located:** `bib-entry-form.tsx:339-341` — `rowHelper()` returns `t('Separate multiple names with "and"')` for `author`/`editor`, rendered as helper line under the field in the **shared entry form** (hence visible in both project edit and library edit). Related but separate: `reference/capture/field-map.json` `helperText` (capture UI). Reviewer's "stray" = the helper line rendered under Author/Editor in the edit form.

**ORCID source (old tree `../old-doi-orcid-picker`, commit `e3c75ff517d21048cf76e273c57c004d0c1de814`, "Initial files"):**
- `services/web/modules/orcid-picker/app/src/OrcidService.mjs` (285 lines): ORCID pub API (`https://pub.orcid.org/v3.0`), `isValidOrcid()` (regex, no Luhn), SSRF guard, 10 s timeout, 2 MB body cap; `searchAuthors(q)`, `fetchWorks(orcid)`, `fetchBibtexFromOrcid(...)`.
- `OrcidPickerRouter.mjs` (86 lines): `GET /orcid-picker/search?q=`, `GET /orcid-picker/works?orcid=` (+ bibtex route — verify exact path during port), all `AuthenticationController.requireLogin()` + `expressify`.
- `orcid-picker-modal.tsx` (583 lines): 2-step modal (search name/ORCID → works list with put-code checkboxes → import), `onInsert(bibtex)` callback; uses `@/shared/components/ol/*` (OLModal, OLButton, OLForm*, OLNotification) + `@/infrastructure/fetch-json` (`getJSON`) — **both exist in this tree** (`services/web/frontend/js/shared/components/ol/`, `.../infrastructure/fetch-json.ts`).
- Old registration: `sourceEditorToolbarEndButtons` + `moduleImportSequence` (`doi-picker`, `orcid-picker`) + `doi-picker` module (parallel DOI-search UI — **not needed here**: DOI import already exists client-side in bib-editor via `frontend/js/utils/doi-fetcher.ts`; do not port unless requested).

**Templates (point 3):**
- Module: `services/web/modules/template-gallery/` (gallery + template manage UI: `manage-template-modal/*`, `menubar-manage-template.tsx`, `template-gallery-context.tsx`).
- Categories today = **env**: `OVERLEAF_TEMPLATE_CATEGORIES=presentation thesis` + `TEMPLATE_<CAT>_NAME` / `TEMPLATE_<CAT>_DESCRIPTION` + `TEMPLATE_ALL_*` (live compose `/data_1/docker/compose_cep/overleafserver/compose.yaml:105-118`), consumed in `template-gallery/index.mjs:26` and injected into the page (`ol-templateCategory` meta; `template-gallery-root.tsx`).
- Gallery on: `OVERLEAF_TEMPLATE_GALLERY=true`; `OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES=false` (admin publish).

**"Out of sync" (point 4) — exact mechanism:**
- The toast/modal the reviewer hit is the **stock editor OT modal**: `services/web/frontend/js/features/ide-react/components/modals/out-of-sync-modal.tsx` (`t('out_of_sync')`), triggered by `closeConnection('out-of-sync')` in `editor-manager-context.tsx:570` — "displays when an op is rejected" (`share-js-history-ot-type.ts:82`), i.e. server/sharejs rejected the client's doc op (version mismatch) → local doc desynced from server.
- So the bug is: bib-editor write/re-sync path produced a client doc state the server rejected (or diverged), and separately the entry list showed a **client-side duplicate** (reviewer: after reload, only one entry remains → the file had one entry).

---

**Admin/feature env state (verified live + tree, 2026-08-28):**
- `ENABLED_LINKED_FILE_TYPES=project_file,project_output_file,url,zotero` (live) — Zotero + url linked-file features are **on live**.
- Zotero module (`services/web/modules/zotero`): router + linked-file agent + `Settings.zotero{clientKey,clientSecret,callbackURL}` are **boot-gated** on `zotero` in enabledLinkedFileTypes (`zotero/index.mjs:6,11-17`); OAuth credentials from `ZOTERO_CLIENT_KEY/SECRET` (set live). Token cipher: `app/src/AccessTokenEncryptorHelper.mjs` (env/file read; default file `/var/lib/overleaf/data/.token-cipher.json`, label `OL_CEP-v3`) — **`github-sync` reuses the same cipher pattern** (shared password ⇒ changing it re-connects BOTH integrations' tokens).
- `enabledLinkedFileTypes` is consumed **per request**: `Features.mjs:76-84`, `LinkedFilesController.mjs:177` (provider check) ⇒ runtime toggling feasible.
- url fetch path: `app/src/Features/LinkedFiles/{UrlAgent,LinkedFilesHandler,LinkedFilesController}.mjs` — **no SSRF blocklist/allowlist is consumed anywhere in this tree** (CE+ wiki's `OVERLEAF_LINKED_URL_BLOCKED_NETWORKS/ALLOWED_RESOURCES` are absent ⇒ must be implemented: §3d).
- Sign-up: `registration-page/index.mjs:6-19` is **boot-gated** (explicit env, else enabled when no ldap/saml/oidc — live has no SSO env ⇒ registration effectively on by default); domain allowlist consumed per-request `RegistrationPageController.mjs:20,64`; feature flag `Features.mjs:55`.

## 1. Goals & acceptance

1. **ORCID picker** available under `/library` → **+ Add → From ORCID.org** and `/project/[id]` → **+ Add → From ORCID.org**; UI matches current Overleaf design language; full audit of all ported code (ported code is suspect); no regressions in lint/tests/build.
2. **Stray string** gone on both surfaces (project entry edit + library entry edit) — root cause named, not just hidden.
3. **Templates**: "Save template" export bundle (zip: project.zip + pdf + template.json) **and** import to make exchange workable; categories stored in MongoDB (see recommendation §2.1).
4. **Out of sync / duplicate entry**: named root-cause mechanism at line level; fix verified with the reviewer's exact repro **in the deployed environment**.
5. **Admin console**: four admin-only "Manage X" pages — Manage Templates, Manage Zotero, Manage External URLs, Manage Sign Up Page — with live-editable settings persisted in MongoDB (env as seed); "Manage X" naming; admin-only access; secrets stored encrypted and masked in UI.

---

## 2. Open decisions & recommendations

### 2.1 Template categories in MongoDB — **ADOPTED (2026-08-28) with user-designed admin UI**
- **Design (user-specified)**: new **"Manage Templates" admin page** (alongside Manage Site/Users/Projects) with:
  - **On/Off switch** for the template gallery (`OVERLEAF_TEMPLATE_GALLERY`, now runtime-stored instead of boot-only).
  - **Table, one row per valid category key** (the 12 from the official manual: `academic-journal`, `book`, `presentation`, `poster`, `cv`, `homework`, `bibliography`, `calendar`, `formal-letter`, `report`, `thesis`, `newsletter` — plus `all`): **a)** category name, **b)** on/off checkbox per category, **c)** number of templates in that category, **d)** "Edit" button → modal to set **name + description** (what `TEMPLATE_<KEY>_NAME` / `TEMPLATE_<KEY>_DESCRIPTION` provided). `all` row: checkbox disabled (code always appends `all`), Edit available (manual has `TEMPLATE_ALL_NAME/DESCRIPTION`).
  - **Defaults = the manual's EXAMPLE block** (12 categories with official names + descriptions, e.g. `thesis` → "Theses" / "Templates for writing theses and dissertations, following institutional formatting and citation guidelines.") embedded as seed defaults in code.
- **Seeding rule**: upsert on boot only if the doc is missing — env wins if the values are set (current compose values preserved), else manual defaults; never overwrite an existing doc (env then only a seed source).
- **Key implementation fact (verified)**: today `template-gallery/index.mjs:13-46` is **boot-gated** — `OVERLEAF_TEMPLATE_GALLERY==='true'` decides whether the router even registers and builds `Settings.templateLinks` from env. The runtime switch therefore requires: register the router **unconditionally**; gate `/templates*` in middleware on the stored setting (404/redirect when off); account-menu "Templates" link and gallery category links must read the stored setting per request (`frontend/js/shared/components/navbar/account-menu-items.tsx` + `admin-menu.tsx` hold the Manage Site/Users/Projects links where "Manage Templates" will be added; `Settings.templateLinks` is built at boot today → must become per-request).

### 2.2 Bundle format — recommended: **zip** (tar = same, but zip is what users expect)
```
<slug>.oltemplate.zip
├─ template.json   { version: 1, name, description, category, tags[], license, language, publishedAt? }
├─ project.zip     (identical shape to the project download/export)
└─ output.pdf      (last successful compile; OPTIONAL on import)
```
- Import validates structure, creates the Template (existing Template model + `services/web/app/templates/` directory), admin-gated (consistent with `OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES=false`).

### 2.3 ORCID import semantics — recommend:
- `/library` → resolve ORCID works → import via the **library server import path** (same as Paste references; 409 duplicate handling already in `LibraryController.mjs`).
- `/project` → resolve ORCID works → import via the **in-project write path** (`planBibImport`/`importMany`) into the currently open `.bib` (needs a selected/first bib file if none is open → same behavior as Paste references).
- (Old build also had an editor toolbar button inserting BibTeX at cursor — NOT in the new requirements; skip unless you want it.)

### 2.4 Stray string — **CONFIRMED (2026-08-28): the stray string is exactly `Separate multiple names with "and"`.** Action: remove the `author`/`editor` helper line from the shared entry form on **both** surfaces; keep the rest (pages/doi/eprint help lines are intentional capture guidance).

---

- **Zotero off-toggle semantics**: existing Zotero linked files are not deleted; connector entry hidden + new zotero links rejected, existing ones show a "disabled by admin" state (documented in UI copy).

### 2.6 Admin console conventions — **ADOPTED (2026-08-28, user-directed)**
- **Naming + access**: pages follow the existing pattern (Manage Site / Manage Users / Manage Projects): **"Manage Templates", "Manage Zotero", "Manage External URLs", "Manage Sign Up Page"** — admin-only (requireAdmin guard + admin-menu visibility; not listed for normal users).
- **Storage**: one `SiteSettings` Mongo doc (key `global`) with per-feature sections (templates / zotero / externalUrl / signup); **stored doc wins over env** (admin intent persists across container cycles); env only seeds a missing doc (values set live today are preserved); per-section "reset to env/defaults" as optional action.
- **Secrets**: Zotero client secret + cipher password stored **encrypted** (reuse proven AES-256-GCM pattern from this fork; investigate cleanest helper), masked in UI, never returned in GET; page-level warning that the cipher is shared with `github-sync` and a password change forces reconnects.

## 3. Phases

### Phase 0 — Stray string (point 2) · ~0.5 day
1. Confirm on live (project + library entry edit): exact element/class where it renders; capture DOM/screenshot (evidence first).
2. Fix at `bib-entry-form.tsx` `rowHelper()` (drop author/editor case — or gate to the *new-entry* modal only if decision 2.4 changes); audit other `rowHelper` render sites; check `field-map.json` helperText is capture-only (not leaking).
3. i18n: remove now-unextracted key usage; `cd services/web && yarn extract-translations` (bundle is filtered by `extracted-translations.json` — keys must be regenerated or they render raw in-browser).
4. Add/adjust module unit test asserting the form's helper mapping.
5. Gates: scoped eslint `--max-warnings 0` → `make all` → cycle container → **verify on FQDN both surfaces** → commit + push (incremental).

### Phase 1 — "Out of sync" + duplicate entry (point 4) · 1–2 days
**Severity: highest (reviewer blocker). Do before Phase 2 — ORCID wiring depends on the same write path.**
1. **Repro on live with the reviewer's exact steps**: edit author → switch to main-text tab (editor area stays open) → back to bib tab → list → observe duplicate → try open entry → capture: modal text, raw `.bib` content, `web.log` (docker exec tail), network OT traffic. Determine: is the duplicate in the file (server) or only in the list (client)? (Reviewer says server has one → focus client model.)
2. **Root-cause hunt** (name the mechanism at a specific line before fixing):
   - `bib-editor-extension.ts`: write dispatch computed from a **stale snapshot** (plan clamped against an old `source`), 300 ms debounced re-parse emitting `entries` *after* a write with stale data, `written` reconciliation (`{id, mode, originalId}`) mis-handled.
   - `bib-editor-provider.tsx` / `bib-editor-context.tsx`: `setEditorState` list reconciliation — append-not-replace on `written.mode==='new'` when it was actually a replace (list keeps old + new → "both are new" if old was already re-serialized).
   - Double event subscription (effect double-registration) → duplicate state updates.
   - OT rejection path: which op was rejected (sharejs version / revision), why (stale base from a second overlapping write or a flush on tab switch) → `out_of_sync` modal.
   - Tab-switch lifecycle: what fires on hide/show (blur commit? pending flush?) with "26 s of unsaved changes".
3. **Fix design (expected shape, final call after step 2)**: list = *pure projection of the current CM doc* (no independent append/replace bookkeeping); single-flight serialized writes; compute the write plan from the **live** view state at dispatch time; on rejection → authoritative resync (re-read doc, re-parse, re-emit) instead of leaving a diverged local doc; dedupe guard on write plan (same key twice → explicit conflict instead of silent duplication).
4. **Tests**: vitest unit tests for `planBibWrite` stale-range/clamp cases + a regression test encoding the reviewer's sequence (edit → re-emit → open) — put the repro steps as a checklist in `services/web/modules/bib-editor/`.
5. Gates as in Phase 0; **done = reviewer repro passes on the deployed site** (list shows exactly one entry, no out-of-sync modal).

### Phase 2 — ORCID picker (point 1) · 2–3 days
**Port (selective — verify every wiring point against THIS architecture, drop dead code):**
- Port: `app/src/OrcidService.mjs`, `app/src/OrcidPickerRouter.mjs`, `index.mjs` (router module), `frontend/js/components/orcid-picker-modal.tsx`.
- Do **not** port: `doi-picker` (DOI import already exists client-side), `orcid-picker-toolbar-button.tsx` (new UX = Add-menu items, not editor toolbar buttons), old `settings.defaults` `sourceEditorToolbarEndButtons` hunk.
- **Full audit of every ported file** (ported code is suspect): imports resolve here (`AuthenticationController` path verified ✓ — re-check at build), hardcoded strings → `t()` + `extract-translations`, `fetch-json` `getJSON` semantics (known quirk: swallows `AbortError` — verify callsites have timeouts/cancellation that work), loading/error/empty states, accessibility (labels, focus management, `bubbles:true` for any CustomEvents), no `console.*` (use `debugConsole`), async handlers wrapped `expressify` (✓ in old code — re-verify), SSRF/timeout/size guards re-verified, ORCID validation (regex OK; Luhn = nice-to-have), React #137 quirk (no `<option>` children in `OLFormControl` selects if the modal has any), `node:` prefix on builtins.
- **Endpoints**: `GET /orcid-picker/search`, `GET /orcid-picker/works`, bibtex route — all `requireLogin`; add unit tests for `OrcidService` pure parts (`isValidOrcid`, author/works mapping, error normalization).
- **UI (current Overleaf style)**: restyle modal to match `bib-manual-modal.tsx` / `bib-import-modal.tsx` patterns (OLModal header/footer, OLButton variants, OLForm* + feedback, OLNotification, plural helpers, loading states); keep the 2-step search→works flow (it's good); verify the same visual system classes (`ol-modal`, `.form-control`, …) so it is indistinguishable from the existing modals.
- **Integration**:
  - `/library`: Add menu (in `library-page.tsx` flow) → new item `From ORCID.org` → modal → import into Library (server path, 409 dup handling).
  - `/project`: Add menu (`bib-entry-list.tsx` C5 area, next to Paste references / Enter manually / Import from Library) → new item `From ORCID.org` → modal → import into current `.bib` (guarded write path) — **depends on Phase 1 being green**.
  - `settings.defaults.js`: add `'orcid-picker'` to `moduleImportSequence`; consider feature flag `OVERLEAF_ORCID_PICKER` (default on, mirror `OVERLEAF_BIB_LIBRARY` pattern) — decide at implementation.
- **Gates**: eslint `--max-warnings 0` on touched scopes → module vitest → fresh-context reviewer pass (diff + behavior) → `make all` (server-ce of THIS checkout) → cycle container (image ID == built ID) → live smoke: search → works → import on **both** surfaces, duplicate-key case, error case (bad ORCID/orcid.org down) → commit + push.

### Phase 3 — Admin console ("Manage X") + template bundles (point 3, expanded 2026-08-28) · ~4–6 days
**3.0 — Shared admin foundation (~1 d, do first):**
1. `SiteSettings` doc (collection `site_settings`, key `global`): `{ templates: {galleryEnabled, categories:[{key,name,description,enabled,order}], nonAdminCanManage?, templatesUserId?}, zotero: {enabled, clientKey, clientSecretEnc, cipherMode:'file'|'password', cipherFile, cipherPasswordEnc?, cipherLabel}, externalUrl: {enabled, blockedNetworks:[cidr], allowedResourcesRegex}, signup: {enabledExplicit, allowedEmailDomains:[]}, seededFrom, updatedAt }` — sensitives encrypted.
2. Boot: seed doc from env if missing (`ENABLED_LINKED_FILE_TYPES`, `ZOTERO_CLIENT_*`, `OVERLEAF_TEMPLATE_CATEGORIES`/`TEMPLATE_*`, registration envs) + the manual's 12 category defaults (§2.1); stored doc wins thereafter; idempotent.
3. Per-request settings accessor (2 web workers ⇒ no process-local truth); de-boot-gate `template-gallery/index.mjs:13`, `zotero/index.mjs:6`, `registration-page/index.mjs:6-19` (preserve registration default rule: enabled when no ldap/saml/oidc, unless explicitly set).
4. Admin shell: `/admin/<section>` routes (guard per `AdminToolsRouter.mjs`), admin-menu items in `frontend/js/shared/components/navbar/admin-menu.tsx` / `account-menu-items.tsx` (alongside Manage Site/Users/Projects), shared scaffold (switch + table/list + Edit modal, i18n, DS-chrome rules from project memory).
5. Unit tests for accessor/seed/precedence + gates + live smoke of the shell.

**3a — Manage Templates (adopted §2.1 design):**
1. Gallery on/off switch (stored `templates.galleryEnabled`) — runtime: middleware gates `/templates*` (404/redirect when off), account-menu "Templates" link per-request, gallery nav renders only enabled categories.
2. Table, one row per valid key (the 12 from the manual: `academic-journal`, `book`, `presentation`, `poster`, `cv`, `homework`, `bibliography`, `calendar`, `formal-letter`, `report`, `thesis`, `newsletter`, plus `all`): **a)** category name, **b)** on/off checkbox per category, **c)** number of templates in that category, **d)** "Edit" button → OLModal to set **name + description** (what `TEMPLATE_<KEY>_NAME/_DESCRIPTION` provided). `all` row: checkbox disabled (always appended by design), Edit available.
3. **Defaults = the manual's EXAMPLE block** (12 categories with official names + descriptions) embedded as seed defaults; live `presentation`/`thesis` preserved via env seeding.
4. **Agreed (2026-08-28)**: publish-permission fields (`OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES`, `OVERLEAF_TEMPLATES_USER_ID`) in the same page (stored in `SiteSettings.templates`; UI: switch + user-id input).
5. **Investigation step first**: pin the Template data model + per-template `category` field (`app/src/Features/Templates/*` + `TemplateGalleryManager`; runtime `templates` dir; `ENABLE_CONVERSIONS=true` live) — needed for per-category counts and bundle category validation.
6. Gates + **verify on live**: gallery unchanged after deploy; disable a category via UI → gallery updates; toggle gallery off → `/templates` 404s + link hidden; turn back on; edits survive container restart (Mongo-backed).

**3b — Save/Import template bundle:**
1. Define bundle + version (per §2.2): `<slug>.oltemplate.zip` = `template.json` + `project.zip` + `output.pdf` (pdf optional on import); document in `services/web/modules/template-gallery/`.
2. **Export** ("Save template"): action in the template manage UI (`menubar-manage-template.tsx` / manage modal) → server endpoint assembles: project zip (existing project download/export path), last successful PDF (same source the template preview pulls), `template.json` from Template fields (category validated against stored categories) → downloadable zip (stream; don't spool large files in memory).
3. **Import**: admin-only upload endpoint → validate (structure, size, magic bytes, no zip path traversal) → create Template + files under the runtime `templates` path → feedback + delete/revert.
4. Tests: zip pack/unpack + validation units; manual e2e (export → wipe → import → gallery shows it → new project from it).

**3c — Manage Zotero:**
1. Feature on/off (stored `zotero.enabled` ↔ `zotero` in enabledLinkedFileTypes; per-request providers check `LinkedFilesController.mjs:177` already supports this; boot agent registration stays when booted-on — off-toggle: hide connector, reject new links, existing show "disabled by admin" state, §2.6).
2. OAuth: client key + **secret (encrypted, masked)** — edit modal; read-only callback URL with copy (`${OVERLEAF_SITE_URL}/user/zotero/oauth/callback`); status line (registered? key set?).
3. Token cipher section: mode file (path, default `/var/lib/overleaf/data/.token-cipher.json`) OR explicit password (encrypted, masked) + label (default `OL_CEP-v3`); **warning UI: shared with `github-sync` — changing the password invalidates existing zotero+github tokens (reconnect required)**; status: cipher file exists? active label? (switch `AccessTokenEncryptorHelper.mjs` reads from the stored settings, env/file as seed).
4. **Investigation step**: verify `Settings.zotero.clientKey/Secret` consumers (`ZoteroOAuth.mjs`, `ZoteroApiClient.mjs`) receive per-request stored values; check `ZoteroRouter` boot behavior when toggled post-boot.
5. Gates + **verify on live**: with a test account — connect/disconnect zotero still works after secret edit; off-toggle hides the connector and blocks a new `zotero` link (404/403 from `LinkedFilesController`), no data loss of existing zotero links.

**3d — Manage External URLs (includes NEW SSRF protection — verified absent in tree):**
1. Feature on/off (stored `externalUrl.enabled` ↔ `url` in enabledLinkedFileTypes; affects "Add Files → from URL" + "Insert Figure → from URL").
2. **Implement** (not just manage): in the url fetch path (`app/src/Features/LinkedFiles/UrlAgent.mjs` / `LinkedFilesHandler.mjs` — locate exact fetch): block fixed private ranges (always): `127.0.0.0/8`, `169.254.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (DNS-resolve all A/AAAA incl. redirect target, reuse the SSRF-guard pattern from the orcid/doi picker code), plus admin **`blockedNetworks`** CIDR list and **`allowedResourcesRegex`** override (regex matches ⇒ allowed even if network blocked; regex syntax-validated in UI with test-URL feedback).
3. UI: switch + blocked-networks list editor (CIDR validation, add/remove rows, show fixed ranges read-only) + allowed-resources regex field (validation + "test URL" check).
4. **Tests**: unit tests for the pure decide function (private range, extra CIDR, regex allow-deny cases); live: loopback/internal URL rejected, public URL works, regex allow case works.

**3e — Manage Sign Up Page:**
1. On/off with CE+ semantics preserved (`registration-page/index.mjs:6-19`): explicit true/false wins; unset → enabled only when no ldap/saml/oidc (live: no SSO ⇒ effectively ON — display the **effective** value + the default rule in the UI).
2. Allowed email domains editor (comma/space list, `*.` wildcard) + live sample check ("would `name@domain` be allowed?") against the stored list; enforced per-request in `RegistrationPageController.mjs` (already per-request ✓).
3. Gates + **verify on live**: toggle off → `/user/register` hidden/404 + signup link gone; domain list enforced (registration attempt with non-listed domain rejected, listed one accepted — test with a local test account).

**Ordering inside Phase 3:** 3.0 → 3a (templates page) → 3b (bundle) → 3c → 3d → 3e (each page after 3.0 is independent; 3d is the only one with new security code).

---

## 4. Cross-cutting rules (machine conventions — binding)
- Lint before build: `cd services/web && node ../node_modules/eslint/bin/eslint.js --max-warnings 0 <touched scopes>`; repo-local eslint binary.
- i18n: new `t()` keys → `yarn extract-translations` (bundle filtered by `extracted-translations.json`); `@overleaf/sorted-keys-in-locales` = alphabetical.
- Async routers: `expressify`; builtins `node:` prefix; `debugConsole` not `console`.
- Build: verify tree contains the changes → `cd server-ce && make all` from THIS checkout (harmless first-build registry-cache line); then cycle the shared `overleafserver` compose container per `rebuild-overleaf-docker-image` skill; image ID == built ID.
- Definition of done: lint 0 → tests green → reviewer pass → build → container healthy → startup log module init, no ERRORs → **live verification on `https://psintern.neuro.uni-bremen.de` (DOM-level, per affected surface)**.
- Commits: incremental at natural milestones, push to `origin` (`davrot/overleaf-cep`); PRs are the user's job.
- Evidence bar: every bug fix = named root-cause mechanism (file:line) before patching; "done" = verified in deployed env.
- Subagent use (if delegating): `overleaf-agent-workflows` skill — fresh-context reviewers, tool budgets, `subagent_wait`; architecture decisions stay in the parent session.

## 5. Sequencing & risk
| # | Phase | Est. | Risk | Note |
|---|-------|------|------|------|
| 0 | Stray string | 0.5 d | low | quick win, independent |
| 1 | Out-of-sync + dup | 1–2 d | **high** | reviewer blocker; blocks ORCID project import |
| 2 | ORCID picker | 2–3 d | medium | port + 2 integrations + restyle |
| 3.0 | Admin foundation (SiteSettings, shell, secrets) | ~1 d | medium | precedence + per-request plumbing, de-bootgates |
| 3a | Manage Templates page | 1–1.5 d | medium | de-boot-gate gallery, per-category counts |
| 3b | Template Save/Import bundle | 2–3 d | medium | zip streaming/limits, admin gating |
| 3c | Manage Zotero page | ~1 d | medium | secret encryption + cipher shared with github-sync |
| 3d | Manage External URLs (+ SSRF guard impl) | 1.5–2 d | **medium/high** | new guard in url fetch path |
| 3e | Manage Sign Up page | 0.5–1 d | low | default-logic parity (SSO rule) |

Total ≈ 2–3 weeks (incl. the expanded admin console). Phases 0 and 1 are sequential-quick; 2 and 3a could be parallelized with subagents after their respective decision points, but default = sequential (one writer per tree).

## 6. Decision log
- (done 2026-08-28) 2.1 categories in Mongo: **ADOPTED** — "Manage Templates" admin page per user design: gallery on/off switch, per-category on/off + name + template count + Edit modal (name/description); defaults from the manual's 12-category example.
- (done 2026-08-28) admin console scope (user-directed): **Manage Templates / Manage Zotero / Manage External URLs / Manage Sign Up Page** — "Manage X" naming, admin-only access; shared `SiteSettings` Mongo doc (stored wins over env, env = seed); secrets encrypted + masked; cipher shared with github-sync caveat. Phase 3 restructured (3.0/3a–3e).
- (agreed 2026-08-28) 2.2 bundle: zip; `output.pdf` optional on import.
- (agreed 2026-08-28) 2.3 ORCID import semantics: library → server import API (409 dup handling); project → append into current `.bib` via guarded write path; no editor toolbar button.
- (agreed 2026-08-28) 2.4 stray string confirmed = `Separate multiple names with "and"`; remove author/editor helper line on both surfaces; keep pages/doi/eprint helpers.
- (agreed 2026-08-28) 3a: publish-permission fields on Manage Templates (stored in `SiteSettings.templates`).
- (agreed 2026-08-28) 3c: secrets stored via fork's AES-256-GCM pattern, masked in UI. 3d: SSRF blocklist/allowlist implementation in scope (CE+ wiki features absent in tree).
- (security rule) Live test credentials (local test user) are used only at runtime for E2E verification — **never written into git/repo files** (incl. this plan).
