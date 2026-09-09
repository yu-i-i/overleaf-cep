> **Historical round log — for current status and open items see `PLAN.md` (single source of truth).**
# UI Round 12 — Plan (2026-08-31, night run)

Context: UI Round 11 (batches A–F) is code-complete and deployed (build 42,
image `569d3be4…bae102`). During the overnight verification the user found
that **all admin site settings under `/admin/site` had vanished** (P0), plus
14 live-UI feedback items. This plan covers recovery + fixes + verification.
Executed autonomously (user asleep); status below is updated as it progresses.

---

## Phase 0 — P0: restore the stored site settings  ✅ DONE

- All 12 sections PUT via the admin API + round-trip verified (matrix below);
  `templates` section was re-saved by the admin at 01:18 and kept intact.
- **Snapshot-backup hardening** shipped: every `setSection` now writes a
  timestamped full-document copy to `site_settings_snapshots` (last 10 kept)
  so the previous state is one command away; + 2 regression tests (save A,
  save B, both remain + snapshot exists) — 27/27 pass.
- **Recovery tooling** committed: `tools/restore-site-settings.mjs` (host
  tool, idempotent, `RESTORE_ALL=1` to force; values reconstructed from:
  `/data_1/docker/compose_cep/.env`,
  `/data_1/docker/compose_cep/overleafserver/compose.yaml.bak-sp`,
   `SSO_TEST_ENV_README.md`, and live test-IdP endpoints (SAML X509 cert from
   IdP metadata; OIDC client secret re-registered on the running IdP).

**Recovery matrix** (all values verified round-trip via `GET /admin/site-settings`):

| Section           | Restored from                                        | Verified |
|---|---|---|
| email        | `.env` (smtp.uni-bremen.de:465, overleaf@uni-bremen.de, secure, skipConfirmation) | ⏳ |
| sso-saml     | README + live `saml:8081` metadata (X509 cert)       | ⏳ |
| sso-oidc     | README + `oidc:8080` (client secret re-registered)   | ⏳ |
| sso-ldap     | README + `ldap:389` (bind creds tested with ldapsearch) | ⏳ |
| sandboxed-compiles | `compose.yaml.bak-sp` (3 TeXLive images, hostdir, socket `/var/run/docker.sock`, www-data) | ⏳ |
| zotero       | `compose.yaml.bak-sp`                               | ⏳ |
| git-integration | `compose.yaml.bak-sp` (git-bridge:8000)            | ⏳ |
| github-sync  | `compose.yaml.bak-sp`                               | ⏳ |
| pandoc       | `compose.yaml.bak-sp` (pandoc:6.2.0)                | ⏳ |
| linked-file-types | `compose.yaml.bak-sp` (project_file, project_output_file, url, zotero) | ⏳ |
| externalUrl  | permissive defaults (bundle import-from-URL E2E)    | ⏳ |
| signup       | enabled, domain `*`                                | ⏳ |
| templates    | already saved (01:18 save kept)                     | ⏳ |

---

## Phase 1 — user feedback items (from the night message)

| #  | Item | Root cause → fix |
|----|------|------------------|
| R12-1 | Sandboxed compiles: TeXLive image table empty; save → 422 "images must be a non-empty array" | Root cause: the env-strip migration left **no** `ALL_TEX_LIVE_DOCKER_IMAGES` env on the web container AND the stored section was wiped (Phase 0) → empty table, failed save. Fix: (a) restored 3 images (Phase 0); (b) hardening — `envSeeds` now falls back to the canonical CE+ TeXLive set (latest-full/TL2024/TL2023 historic) when neither stored nor env provides images, so the tab can never dead-end. ✅ code |
| R12-2 | `/admin/site` sidebar shows a second Theme fieldset "outside the menu" — remove it | Removed `<ThemeSelector />` from `ManageSidebar` (site-settings-page.tsx); the toggle stays in the Account menu. ✅ code |
| R12-3 | Navbar links: `Library`/`Templates` render `subdued` (wrong) instead of the round-button style of `Projects` — on every listed user page | ✅ code — `ce-navbar-consistent.scss`: `.subdued` links get the pill border/padding/hover vars of the active link (theme-aware variables). |
| R12-4 | "Header not reactive to dark/light mode" on user pages | ✅ code — removed R11's white-in-both-themes pin; user pages keep `background-image:none` (no red gradient) on the solid **theme-aware** `--navbar-bg` surface; upstream `navbar-dark` (dark) / `navbar-light` (light) now apply. Admin pages keep the red gradient. |
| R12-5 | `/user/mysettings` left nav hangs out of the displayable region, incomplete | ✅ code — root cause: shell `min-height:100vh` inside the DS page layout's fixed-height (913px) scrolling `#main-content` → removed the 100vh min-height so the column fits the region. |
| R12-6 | `/user/mysettings` style should mirror `/admin/site` | ✅ code — content column is now a `ce-admin-card` white card (user-my-settings.pug + ce-admin-shells.scss) with dark input/label pin. |
| R12-7 | `/templates/manage` → Edit fails: `GET /template/:id/edit` 404 | ✅ code — root cause: `/template/:id/edit` is **POST-only**; the in-place edit view is `GET /template/:id`. Edit link now points there (same as upstream EditTemplateButton). |
| R12-8 | `/admin/panel` left nav overflows the displayable region | ✅ code — same min-height fix as R12-5. |
| R12-9 | `/admin/panel`: Open Sockets, Privileges Matrix, TPDS/Dropbox Management, Debug Projects are "empty husks" — remove | ✅ code — removed the four nav entries + panes from admin-panel.pug (kept System Messages / Active Projects / Open/Close Editor); pug gate clean. |
| R12-10 | `/library` list scrollbar always visible — hide until needed | ✅ code — `.bibtex-entry-list-body`: thin/transparent scrollbar that materializes on hover/focus (WebKit + Firefox rules). |
| R12-11 | Project-page bibliography resizer updates laggy vs library | ✅ code — root cause: `SplitResizer` ran a React `setState` + localStorage write on every pointermove; now the drag writes the CSS var directly and commits state+storage once on release (keyboard path unchanged). |
| R12-12 | Template-gallery admins: testjoe (site admin **and** flagged) shows "Revoke" while other site admins show "managed via site-admin role" — inconsistent | ✅ code — `revertible = hasTemplateFlag && !isAdmin` (revoking the flag wouldn't change a site admin's access anyway — misleading). |
| R12-13 | `/templates/manage` content unstyled vs `/admin/site` | ✅ code — bundle section restyled as `ce-admin-card` (card-header/card-body, `table table-sm`, `form-control-sm`) dropping the inline boilerplate. |
| R12-14 | Sandboxed compiles "+ Add image" button invisible (btn-outline-secondary on white) | ✅ code — `btn-outline-primary` (clear on white in both themes). |

## Phase 2 — verification (after build & deploy)

1. All 13 admin tabs: values present, **Save → 200** (no 422), round-trip stable.
2. SSO E2E: SAML ✅ / OIDC ✅ live logins verified (land on `/project`).
   **OPEN (P1, not in the user's 14 items): LDAP live-login regression.**
   Stored config verified correct in `sharelatex.site_settings` (url,
   searchBase, bindDN, encrypted bindCredentials, searchFilter, searchScope).
   Library path works: in-container `LdapAuth.authenticate` returns carol's
   dn+mail; raw ldapjs admin-bind→mail-search→user-bind all succeed from the
   web container (openldap ACL allows cn=admin read, user bind err=0).
   But the live strategy path finds carol (server log `nentries=1`), then drops
   the connection before the user-bind → falls back to local auth → "invalid
   credentials". SAML/OIDC unaffected. Next step: diff the exact `server`
   option object the live `refreshSsoStrategy` builds vs the working
   in-container one (suspects: timeout/connectTimeout left undefined, or a
   doubled strategy registration shadowing the good one per worker), with the
   ldap server log as the oracle.
3. R12-1…R12-14 each verified on the listed URLs, dark **and** light theme
   (navbar pill style + theme reactivity on all listed user pages; admin
   gradient retained; both shells no-overflow; resizer timing; library
   scrollbar; gallery admins table; /templates/manage styling; Edit 200).
4. R11 regression re-check: navbars (user pages theme-reactive, admin
   gradient), Account item placement, card text contrast, bundle
   edit/delete/download, split 9/9, theme toggle from account menu persists.
5. Console-error sweep on all admin/user pages (both themes).
6. Unit tests: site-settings (incl. new snapshot-merge regression test),
   bundle import return, module-boot-contract, page-shells, email-test.
7. Lint all touched files (`--max-warnings 0`).

## Phase 3 — ship

`make all` (0 webpack errors) → deploy → IMAGE_MATCH → verification above →
`BUGHUNT_ROUND2_REPORT.md` (incl. P0 recovery + all R12 items) → commit +
push to `bib-editor`.

**Definition of done:** settings restored and durable (snapshot backups
active), all 14 items fixed & verified, R11 regressions green, report
pushed, site up.

## R12-15 .. R12-17 — live bug report (2026-08-31, user test of /templates/manage)

### R12-15 (P1) Bundle "Import from URL" 500 — missing export [DONE build 45: 409 same-name conflict on the user's real zip; 500 gone]
- **Repro**: /templates/manage → Template bundles → Import from URL… → POST
  `/template/bundle/import-url` → **500**.
- **User console**: `UrlAgent.default.fetchWithPolicyRedirects is not a
  function` (browser `Error with Permissions-Policy header: Unrecognized
  feature: 'attribution-reporting'` is unrelated console noise — see R12-17).
- **Root cause**: `fetchWithPolicyRedirects` IS implemented in
  `app/src/Features/LinkedFiles/UrlAgent.mjs` (and used by
  `createLinkedFile`), but it was never added to the module's **default
  export object**; `TemplateGalleryManager.importTemplateBundleFromUrl`
  calls `UrlAgent.default.fetchWithPolicyRedirects(...)` → undefined → 500.
- **Fix**: export `fetchWithPolicyRedirects` on the default object +
  `promises` + named export; add a regression test (local HTTP server:
  direct fetch + redirect hop re-checked against policy + blocked-host hop
  must reject) in `modules/template-gallery/test/unit`.
- **Status**: SHIPPED + VERIFIED (build 45; local-server regression suite 36/36; live POST → 409 override flow).

### R12-16 (P2) Bundle URL input placeholder
- **User request**: placeholder `//…/template.bundle.zip` (rendered) is not
  URL-like; change to a realistic example, e.g.
  `https://www.example.com/.../Test_1_cccc_v1.bundle.zip`.
- **Fix**: proper i18n key `templateBundles.urlPlaceholder` in BOTH
  `locales/en.json` + `frontend/extracted-translations.json`, used in
  `template-bundles.tsx` (replaces the raw-string `t('https://…/…')` hack).
- **Status**: SHIPPED + VERIFIED (build 45; DOM placeholder = full https URL — note: the URL must stay in the i18n VALUE; a `:`-bearing KEY is parsed as ns:key by i18next)

### R12-17 (P3) Console warning: Permissions-Policy feature
- **Symptom**: every page logs `Error with Permissions-Policy header:
  Unrecognized feature: 'attribution-reporting'` (modern Chrome dropped
  the directive from the spec).
- **Fix**: remove `attribution-reporting` from the default `blocked` list in
  `config/settings.defaults.js` (no-op directive; other browsers ignore
  unknown directives, so behavior is unchanged).
- **Status**: SHIPPED (build 45; Permissions-Policy header no longer contains attribution-reporting).
