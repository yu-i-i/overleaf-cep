> **Historical round log — for current status and open items see `PLAN.md` (single source of truth).**
# SSO Multi-Provider — Plan (CE+ integration, env-free, tested against the three test IdPs)

**Branch:** `bib-editor` · **Live:** https://psintern.neuro.uni-bremen.de · **Date:** 2026-08-29

## 1. Requirements

- **A.** Several SSO providers **simultaneously** (SAML + OIDC + LDAP can all be on at once), each with its own button on the login page.
- **B.** Stop relying on SSO **environment variables** as the runtime config source. Config lives in the DB and is administered through **three new tabs at `/admin/site`**: `SSO SAML`, `SSO OIDC`, `SSO LDAP`. Secrets are stored safely (encrypted), masked on read, and empty-save keeps the stored value.
- **C. Integrate the old CE+ SSO code** from `~/junk_bib/sso`, **commit `fe4ceb6ba20a9e07cc3e954134988b3bf720d157` only** (git history after that commit is broken — do not take anything newer). Verify everything works.
- **D. Test against the existing test IdP stacks** in `~/junk_bib/benchmark_overleaf_vm/compose/production/`:
  - LDAP → `.../ldap` (osixia/openldap, `:389`)
  - SAML → `.../saml` (Flask IdP, `:8081`)
  - OIDC → `.../oidc` (Flask IdP, `:8080`)

## 2. What already exists (recon done)

### 2.1 Old CE+ code (`~/junk_bib/sso @ fe4ceb6`)

| Piece | Location | What it does |
|---|---|---|
| `ssoConfigLoader.mjs` | `services/web/modules/authentication/` | **The seam.** Reads one DB doc `{ _id: 'sso-settings' }` from collection `ssoConfigs` with shape `{ ldap: {...}, providers: [ { type: 'saml', enabled, issuer, entryPoint, audience, idpCert, privateKey, decryptionPvk, authnContext, validateInResponseTo, requestIdExpirationPeriodMs, identityServiceName, userIdField, emailField, firstNameField, lastNameField, isAdminField, isAdminFieldValue, updateUserDetailsOnLogin }, { type: 'oidc', enabled, issuer, authorizationURL, tokenURL, userInfoURL, clientID, clientSecret, scope, logoutURL, userIdField, allowedEmailDomains, ... } ], loginPage: {...} }`. Exports `loadSSOConfig()`, `isLDAPEnabled()`, `isSAMLEnabled()`, `isOIDCEnabled()`, `getLDAPConfig()`, `getSAMLProviderConfig()`, `getOIDCProviderConfig()`, `getLoginPageSettings()`, `clearConfigCache()`. DB wins, env fallback. |
| `utils.mjs` | same dir | `readFilesContentFromEnv`, `numFromEnv`, `boolFromEnv`, `splitFullName` — **already present in our repo.** |
| `logout.mjs` | same dir | Provider-aware user logout (`req.user.externalAuth` → `passportLogout`) — **already present in our repo**, already wired by `OIDCRouter` + `SAMLNonCsrfRouter`. |
| Module managers | `modules/authentication/{saml,oidc,ldap}/app/src/*ModuleManager.mjs` | `initSettings()` is **async**: `getSAMLProviderConfig()` etc. from the loader → sets `Settings.saml/oidc/ldap` **and** `Settings._samlDbProvider/_oidcDbProvider/_ldapDbConfig` (raw provider doc). `passportSetup()` builds the passport strategy from `Settings`/`_*DbProvider`, env fallback branch otherwise. |
| Controllers/managers | same | `*AuthenticationController` (doPassportLogin, register-or-login semantics, admin-attribute handling, `passportLogout`), `*AuthenticationManager.findOrCreateUser` (create user, confirm email, unset `hashedPassword`, `updateUserDetailsOnLogin`, `splitFullName`). |
| `index.mjs` (per provider) | | Boot gates: `EXTERNAL_AUTH.includes(type) \|\| await is*Enabled()` → load manager, `await initSettings()`, `initPolicy()`, register router(s). |
| `SSOConfig.mjs` model + `admin/` module (SSOAdminController, sso-admin.pug) | | Their separate SSO admin page + mongoose model. **Not ported** — the UI requirement is the three tabs at `/admin/site` (done), and our config store is site settings (below), which encrypts their secrets (their `ssoConfigs` stored raw). |

### 2.2 Our repo — already done this session (working tree, **not yet built/deployed**)

- `SiteSettingsManager.mjs`: sections **`sso-saml` / `sso-oidc` / `sso-ldap`** — validators, env seeding from `OVERLEAF_SAML_*/OIDC_*/LDAP_*` (seed layer only), **secret encryption** via `SecretCipher` (`idpCert`, `privateKey`, `decryptionPvk`, `clientSecret`, `bindCredentials`), masked GET (`*Set: true`), empty-string keeps stored value.
- `SiteSettingsController.mjs`: `GET /admin/site-settings` returns all three sections masked; `PUT /admin/site-settings/<section>` + **resync of global `Settings.*` via `sso-runtime` after save**.
- `modules/authentication/sso-runtime.mjs` (new): **lazy strategy bridge** — `resolveProvider(type)` (stored → env seed) with 30 s cache + `invalidate()`, `syncSettings(type, resolved)`, `attachLazyAuth(strategy, type, build)` → strategy registered once at boot; per login request it re-resolves config (cache-busted on admin save) and delegates `authenticate()` to a freshly built real strategy (passport clones the registered strategy per request and augments `success/failure/redirect/error` on that clone — delegation via `.call(clone, …)` is exactly passport's own contract, verified against `node_modules/passport/lib/middleware/authenticate.js`).
- Manager `passportSetup` wrappers (lazy bridge) in all three `*ModuleManager.mjs`, `index.mjs` boot-gates removed (always load), `initSettings` env-seeded (so a no-SSO deployment still behaves as CE).
- `UserPagesController.loginPage`: request-local `res.locals.settings` merge of the three resolved sections → login page buttons/labels reflect admin config live.
- **Admin UI**: `site-settings-page.tsx` has three new tabs **SSO SAML / SSO OIDC / SSO LDAP** (SECTIONS, types, render), new `sso-settings-tab.tsx` (`SamlSsoTab`/`OidcSsoTab`/`LdapSsoTab`, per-provider `PUT` save, secret placeholders "configured", server-side validation errors surfaced).
- i18n: 34 `adminSite.sso*` keys in `locales/en.json` + `extracted-translations.json`.
- Unit tests: `site-settings.test.mjs` updated for the 3 new validators — **481/481 green**.
- `BIB_ORCID_TEMPLATES_PLAN.md`: R7+R8 already appended (SSO entry to add at the end).

### 2.3 Test IdPs (exact data)

**LDAP** — `compose/production/ldap` (osixia/openldap, ports 389/636, `overleaf-network`):
- base `dc=example,dc=com`, admin `cn=admin,dc=example,dc=com` / `admin_password`, readonly `ldap_reader` / `GoodNewsEveryone`, `LDAP_TLS=false`
- ldif users (incl.): **`carol.jones@example.com` / `carolpass`** (uid `cjones`, cn `Carol Jones`), John Doe, Alice Smith, an admin user flagged by `employeeType`, Bob Wilson.

**SAML** — `compose/production/saml` (Flask, port 8081, `overleaf-network`; already env-overridable):
- env knobs: `IDP_ENTITY_ID` (default `https://overleaf.local/saml/idp`), `SP_ENTITY_ID` (default `MyOverleaf`), `SP_ACS_URL` (default `https://overleaf.local/saml/login/callback`), `SP_SLS_URL`; attrs: `ATTR_EMAIL=email, ATTR_GIVEN_NAME=givenName, ATTR_SURNAME=lastName, ATTR_MAIL=mail, ATTR_IS_ADMIN=is_admin`
- IdP users: **`test@example.com` / `password`**, `admin@example.com` / `admin` (is_admin), `overleaf.admin@example.com` / `admin` (is_admin)
- flows: GET `/saml/idp/metadata`; **SLO** `/saml/idp/SingleLogoutService`; **SSO** `/saml/idp/SSOService` (GET login form, POST login → signed SAMLResponse with `NameID=emailAddress`, `Audience=SP_ENTITY_ID` POSTed to ACS); **serves its own cert at `http://<idp>:8081/saml/idp/certs/idp_cert.pem`**
- certs persisted in `saml/certs/` (auto-generated on first boot: `saml_private_key.pem`, `saml_certificate.pem`)

**OIDC** — `compose/production/oidc` (Flask, port 8080, `overleaf-network`; **currently hardcoded → make env-overridable**):
- constants to env-ify: `ISSUER` (default `https://overleaf.local/sso/realms/master`), `CLIENT_ID` (`overleaf_test`), `CLIENT_SECRET` (`SOMEPASSWORD`), `VALID_REDIRECT_URI` (`https://overleaf.local/oidc/login/callback`)
- Keycloak-style endpoints under `/<issuer path>`: `.well-known/openid-configuration`, `protocol/openid-connect/{auth,token,userinfo,logout,certs}`; **HS256** tokens, `JWT_SECRET = "your-secret-key-change-in-production"` (also env-ify)
- users: **`test2@example.com` / `password`**, `admin@example.com` / `admin` (is_admin)

**Host environment facts:**
- `overleaf-network` docker bridge **already exists** (`46292eca8794`); overleaf CE containers run on the compose_cep network — plan: start IdPs on `overleaf-network` and `docker network connect overleaf-network overleafserver` (verify first), so the SP resolves `oidc`/`saml`/`ldap` by container DNS names.
- `/etc/hosts` already maps `psintern` + `overleaf.local` → 127.0.0.1; **add `oidc saml ldap` → 127.0.0.1** so the CDP browser (running on this host) can reach the IdPs by the same names on the published ports 8080/8081.
- Repo dependencies: `@node-saml/passport-saml ^5.1.0`, `passport ^0.6.0`, `passport-ldapauth ^3.0.1`, `passport-openidconnect ^0.1.2`, `samlp ^7.0.2`.

## 3. Architecture decision (documented)

- **Config source of truth = site settings sections** (`sso-saml/sso-oidc/sso-ldap`, encrypted secrets, masked API, per-section validation/invalidation) — **not** CE+'s raw `ssoConfigs` collection. Rationale: the `/admin/site` tabs requirement, encrypted secrets (CE+ stored plaintext), and existing guard/audit machinery.
- **CE+'s provider code is the implementation**: we port their manager/controller/manager code from `fe4ceb6` (it is the battle-tested version against these exact test IdPs) and **rewire only the config seam** — i.e. we ship a **`ssoConfigLoader.mjs` with the exact fe4ceb6 export API** but whose internals resolve **purely from our stored site-settings sections** (D7: no env seeding for SSO). Their managers then run with their env-fallback branches inert (the loader never returns an env-based provider; unset section ⇒ disabled).
- **Runtime activation without restart** (improvement over CE+): CE+ only gates strategy registration at boot. We keep our `sso-runtime` lazy bridge: strategies are always registered; on each login attempt the config is re-resolved (admin save → `invalidate()` + `syncSettings`), disabled providers fail cleanly, enabled ones work — so all three can be on, off, or flipped live.
- **Env variables** remain only as *seed/fallback* values (CE+ semantics: stored/DB wins, else env). This satisfies "get rid of env" for real deployments (admin-managed) while keeping CE compatibility.
- Their `admin/` module, `emailConfigLoader`, `SSOConfig` model, and the frontend SSO widgets (CE+ user-settings SSO linking) are **out of scope** — we keep the CE login/register flow; UI = `/admin/site` tabs. *(Email tab is the exception — see §7.2/11b: we DO port the `emailConfigLoader`/`EmailAdminController` logic, folded into a tab, with `EMAIL_*` env as seed.)* **SSO env handling (D7 final): the `EXTERNAL_AUTH` / `OVERLEAF_SAML_*` / `OVERLEAF_OIDC_*` / `OVERLEAF_LDAP_*` env are removed from compose and NOT a runtime fallback — the SSO trio resolves purely from stored site settings (unset ⇒ disabled); the env branches in the fe4ceb6 managers are dead in our integration.**

## 4. Phases

### Phase 1 — Port CE+ provider code (from `fe4ceb6`)
1. Copy (exact files, commit `fe4ceb6`):
   - `modules/authentication/{saml,oidc,ldap}/app/src/{ *ModuleManager, *AuthenticationController, *AuthenticationManager }.mjs`
   - verify `utils.mjs` / `logout.mjs` already match (diff; they match upstream except our `utils.mjs` already exists — diff to be sure).
   - **Do not copy**: `admin/`, `emailConfigLoader.mjs`, `SSOConfig.mjs`, any `ssoConfigs` model registration.
2. Create `modules/authentication/ssoConfigLoader.mjs` — **same exported API as fe4ceb6** (`loadSSOConfig, isLDAPEnabled, isSAMLEnabled, isOIDCEnabled, getLDAPConfig, getSAMLProviderConfig, getOIDCProviderConfig, getLoginPageSettings, clearConfigCache`), internals = **stored site-settings sections ONLY** (`SiteSettingsManager.getSection('sso-<type>', Settings)`; **no env seed — D7**); map our section field names to the fe4ceb6 provider shape (e.g. SAML `entrypoint→entryPoint`, `attUserId→userIdField`, `attEmail→emailField`, `attFirstName→firstNameField`, `attLastName→lastNameField`; OIDC `allowedOIDCEmailDomains→allowedEmailDomains`; LDAP section as-is + `emailAtt` etc.). Expose raw provider object (secrets decrypted) on `Settings._samlDbProvider` / `Settings._oidcDbProvider` / `Settings._ldapDbConfig` compat surface where managers read it — prefer reading through `Settings.saml/oidc/ldap` (set by their `initSettings`). **Implementation change from earlier build: remove the SSO env-seed builders from `SiteSettingsManager` (they were 'seed layer') — stored value is the only source; an admin on a fresh install just fills in the tab.**
3. Rebuild the three lazy-bridge wrappers (from Phase-0 work this session) on top of the **ported** managers (their `passportSetup` is boot-style; wrap it: registered strategy = proxy; per request → `resolveProvider` → run their `initSettings()` (fresh) → build their strategy → delegate `authenticate`). Keep `callback(null)` semantics for `Modules.hooks.fire('passportSetup', …)`.
4. Keep `index.mjs` always-load (no boot gate) so runtime enabling works; `initSettings` still runs at boot for default `Settings.*`.
5. Verify every cross-reference compiles (`node --check` per file), imports of `SSOConfig`/`ssoConfigs` do **not** sneak in (grep).

### Phase 2 — Admin surface (already built; finish mapping)
- Tabs + API + secret masking + i18n: **done** (list in §2.2). Re-check that tab field names are normalized by the loader (Phase 1-2) so no extra UI changes.
- Add to SAML tab (small): `privateKey` + `decryptionPvk` secret fields + `validateInResponseTo` (checkbox), since CE+ manager path uses them (and real IdPs need them). *(Optional; the Flask test IdP only signs.)*

### Phase 3 — Login page + logout wiring
- Login page merge: **done** (request-local settings). Verify all three buttons render simultaneously (pug reads `settings.saml.enable && settings.saml.identityServiceName` / `settings.oidc.enable` / `settings.ldap.enable`).
- Logout: `logout.mjs` + `passportLogout*` exist and are routed (`/saml/logout/callback`, `/oidc/logout/callback`). Verify the main `/logout` path triggers provider SLO for `externalAuth` users (patch `UserPagesController.logout`/authentication logout controller if the CE path skips it).

### Phase 4 — Unit tests (extend existing `site-settings.test.mjs` suite + new `sso-config-loader.test.mjs`)
- loader: stored-wins-over-env per provider; secret decryption into provider shape; disabled → `is*Enabled() === false`; empty-section → env seed; cache invalidation via `setSection`.
- resync: `SiteSettingsController` save path calls `resolveProvider` + `syncSettings` (mock).
- keep the existing 481 green.

### Phase 5 — Build & deploy
1. `cd services/web && node ../../node_modules/eslint/bin/eslint.js --max-warnings 0 <touched files>`
2. unit suite (command in §2.2, `MONGO_URL=…vitest run …`), expect ≥ 487 tests passing.
3. `cd server-ce && make all` (full webpack TS check).
4. Deploy: `cd /data_1/docker/compose_cep && docker compose -f compose.yaml down overleafserver && docker compose -f compose.yaml up -d overleafserver`; wait `UP` ~15 s; `docker logs overleafserver --tail 40` — must show passportSetup OK for all three (our lazy bridge logs `passportSetup for X registered`); no `SSOConfig`/loader import errors.

### Phase 6 — Start the three test IdPs ("transfer" them here)
```bash
# 1) shared network (exists: overleaf-network)
docker network ls | grep overleaf-network || docker network create overleaf-network

# 2) OIDC: make constants env-overridable (small patch in that dir's app.py):
#    ISSUER / CLIENT_ID / CLIENT_SECRET / VALID_REDIRECT_URI / JWT_SECRET → os.getenv(...)
cd ~/junk_bib/benchmark_overleaf_vm/compose/production/oidc
docker compose up -d --build
# 3) SAML (already env-driven) — point IdP at our live SP (browser side), keep container-name base for nothing; IdP only needs ACS/SLS:
cd ../saml
SP_ACS_URL=https://psintern.neuro.uni-bremen.de/saml/login/callback \
SP_SLS_URL=https://psintern.neuro.uni-bremen.de/saml/logout/callback \
docker compose up -d --build
# 4) LDAP
cd ../ldap
docker compose up -d
# 5) connect the SP container to the IdP network + host DNS for the CDP browser
docker network connect overleaf-network overleafserver
docker exec overleafserver node -e "require('dns').lookup('oidc',(e,a)=>console.log(a))"
echo '127.0.0.1 oidc saml ldap' >> /etc/hosts
curl -s localhost:8080/health; curl -s localhost:8081/health
```
- Grab SAML IdP cert: `curl -s localhost:8081/saml/idp/certs/idp_cert.pem` → this is the admin-tab `idpCert` value.
- Configure via the **admin API** (with `X-Csrf-Token`): `PUT /admin/site-settings/sso-{saml,oidc,ldap}` using container DNS hosts for SP-side URLs:
  - SAML: `issuer=MyOverleafSP` (or `MyOverleaf`), `audience=<same value as IdP SP_ENTITY_ID>`, `entrypoint=http://saml:8081/saml/idp/SSOService`, `idpCert=<pem>`. IdP env: `SP_ENTITY_ID=<same>`, `IDP_ENTITY_ID=http://saml:8081/saml/idp`.
  - OIDC: `issuer=http://oidc:8080/sso/realms/master`, `clientID=overleaf_test`, `clientSecret=SOMEPASSWORD`, (auth/token/userinfo URLs from discovery), `scope=openid profile email`; IdP env: `VALID_REDIRECT_URI=https://psintern.neuro.uni-bremen.de/oidc/login/callback` (+ matching `ISSUER` **string** the IdP signs into the id_token — must equal SP `issuer`; reconcile: SP-side `issuer` used for discovery AND token validation must match the IdP-signed issuer → set IdP `ISSUER=http://oidc:8080/sso/realms/master`).
  - LDAP: `url=ldap://ldap:389`, `searchBase=dc=example,dc=com`, `bindDN=cn=admin,dc=example,dc=com`, `bindCredentials=admin_password`, `emailAtt=mail`.
- `/etc/hosts` `127.0.0.1 oidc saml ldap` lets the browser open `http://saml:8081/…` and `http://oidc:8080/…` directly (same names the SP uses).

### Phase 7 — Live verification matrix (CDP driver `modules/bib-editor/test/e2e/cdp.mjs`, fresh profiles)
For **each** provider (test with all three **enabled simultaneously**):
1. `/login` shows **all three** SSO controls + the local password form (A ✓).
2. **LDAP**: login `carol.jones@example.com` / `carolpass` → session → `/user` shows Carol; repeat with existing local account email (`notadmin@rotermund.at`) to hit the "user exists → login (no password needed)" branch.
3. **SAML**: click button → `/saml/login` → 302 to `http://saml:8081/saml/idp/SSOService` → IdP form `test@example.com`/`password` → signed SAMLResponse to ACS → logged in as `Test User`; admin user `admin@example.com`/`admin` → `isAdmin` true.
4. **OIDC**: click button → authorize at IdP → login `test2@example.com`/`password` → token+ID-token exchange (HS256 vs `JWT_SECRET`) → logged in.
5. Negative: wrong password at IdP → error, not logged in; disabled provider → button gone (toggle via admin API without restart → recheck login page + attempt).
6. Regressions: local login `testjoe@rotermund.at` still works; account menu, `/user`, editor load; `GET /admin/site-settings` masks `clientSecret`/`idpCert`/`bindCredentials` but reports `*Set:true`; saving without touching a secret keeps it.
7. Admin-tab round-trip in the real UI: `/admin/site` → SSO tabs → edit OIDC clientSecret (empty → keeps) → Save → success flash → GET reflects state.
8. Console: zero `Uncaught` / `Failed to load resource` on login page, admin page, and IdP redirect hops.

Acceptance: **all items 1–8 green, unit suite green, zero lint warnings on touched files**, then commit + push `bib-editor` and update `BIB_ORCID_TEMPLATES_PLAN.md` + TODO `SSO_MULTI_PROVIDER`.

### Phase 8 — Docs & cleanup
- `modules/authentication/README.md`: sources (commit hash), field mapping table (tab field → provider field → env seed), how to disable.
- Remove/retire my interim files if superseded (`sso-config-section` helpers already live in SiteSettingsManager — fine).
- Close TODO `SSO_MULTI_PROVIDER`; memory note: `fetchJsonWithResponse` vs ssoConfigLoader, HS256 gotcha, network/hosts setup for repro.

## 5. Risks / open questions (verify in order)

1. **OIDC id_token validation**: IdP signs **HS256** with `JWT_SECRET`; `passport-openidconnect@0.1.2` (old `openid`-client based) may expect a JWKS/RS256. Verify its validation path with the ported controller (`req.oidc`/`idToken` usage seen in fe4ceb6 controller). Fallback: patch test app.py to RS256 + serve matching `jwks` (cryptography lib is already there).
2. **SAML audience/issuer**: IdP assertion `Audience=SP_ENTITY_ID`; node-saml verifies `audience` setting — keep SP `issuer`, `audience`, and IdP `SP_ENTITY_ID` all **identical** (`MyOverleaf`).
3. **LDIF admin-user detection**: fe4ceb6 LDAP manager flags admin by `attAdmin/valAdmin` (their ldif uses `employeeType`) — configure `isAdminAtt`/value accordingly (or skip admin-assertion sub-check in step 7.2/7.3 by using plain users).
4. Overleaf `Settings.siteUrl` (used for `callbackURL`) must be `https://psintern.neuro.uni-bremen.de` (compose env `SITE_URL`/`externalUrl` — verify; it is set from `site_settings.externalUrl` — check live value).
5. Passport strategy-name collisions: `saml`, `openidconnect`, `ldapauth` are unique (google/facebook/local use others) — OK.
6. `ssoConfigLoader` import cycle: it imports `SiteSettingsManager` (which imports mongodb) — safe from module dirs (they already import `../../app/src/infrastructure/mongodb.mjs`).

## 6. Execution checklist (state)

- [x] Recon: fe4ceb6 code + test IdP stacks + environment (§2)
- [x] Config layer (site settings sections, masking, validation, resync) — built, unit-tested (481/481)
- [x] Admin UI: three `/admin/site` tabs + i18n
- [x] Runtime lazy bridge + loginPage merge
- [ ] **Port fe4ceb6 managers/controllers + ssoConfigLoader seam** (Phase 1)
- [ ] Optional SAML `privateKey/decryptionPvk` tab fields (Phase 2)
- [ ] Logout wiring check (Phase 3)
- [ ] Loader unit tests (Phase 4)
- [ ] Build + deploy + boot log (Phase 5)
- [ ] Start 3 test IdPs + network/hosts + admin config (Phase 6)
- [ ] Live verification matrix all green (Phase 7)
- [ ] Docs + commit/push + TODO close (Phase 8)
- [ ] **R9 backlog: items 1–8 UI/UX fixes** (§7.1)
- [ ] **R9 backlog: six new `/admin/site` tabs** (§7.2)
- [ ] R9: Pandoc `Dockerfile-pandoc` + Makefile import (§7.3)
- [ ] R9: email settings port from fe4ceb6 (§7.2/11b)
- [ ] **R9: env removal from compose.yaml — standalone proof** (§7.4)
- [ ] **§8 intensive bug hunt** (final gate)

## 7. R9 backlog — live feedback round 2026-08-29 (add these to the plan; execute after SSO phases or interleaved as quick fixes)

### 7.1 UI/UX fixes (items 1–8) — mostly frontend + small API guards

**1. `/library` card styles out of date** — project view cards render the new markup and look right:
`.bibtex-entry-card` → `.bibtex-entry-card-content` → `key-row (key + error icon) → title → author → year`. The `/library` page shows the OLD style — its stylesheet(s) were never updated for the restructured card (R7 item 7 changed `bib-editor-panel.css` + `bib-library.css` for the panel context, but the library page loads a different CSS entry — find the stylesheet(s) the library root imports (check `library-page.tsx`/root + webpack entry) and port the card rules there for BOTH themes. Verify against the exact DOM above (compact + full, error/dup icons, previewing/clickable states).

**2. Column resizer (project panel + library)** — in `/project/6a904035…` the border between `.bibtex-entry-list` and `.bibtex-entry-preview-panel` inside `.bibtex-list-and-preview` is **not draggable**; in `/library` there is a scrollbar instead, also not draggable. Implement a proper splitter in both layouts: `grid-template-columns` (or flex-basis) driven by a % state, a visible `col-resize` handle (e.g. 6 px gutter) with `pointerdown/move/up` (or a tiny drag hook), min/max widths (e.g. 25–75 %), no page scroll side-effects on the library (replace the accidental scrollbar with the handle), persist the ratio (localStorage per page), keyboard-accessible (arrow keys ±5 %). Shared component so panel + library behave identically.

**3. `/admin/site` → Templates → *Template gallery admins*: block revoking the role from real site admins.** Server-side guard in `UserListController` (and API): a user with `isAdmin`/site-admin status may not be removed from `templateList`/`canManageTemplates` via this table; return 409 with a clear message; disable the checkbox for those rows client-side with a tooltip. (Site admins are template admins implicitly — see `TemplateAuthorizationHelper`.)

**4. `/templates`: closing the expanded (sub-)menu triggers a page reload.** Reproduce: open the sidebar expanded template menu, close it → unwanted navigation/reload. Root-cause the close handler in `ds-nav`/template-admin sidebar (likely the caret/summary link still submitting/navigating, or a `location.assign` side effect); fix so close is a pure state toggle (no form submit, `e.preventDefault`, no anchor follow). Verify in CDP: no `/navigate` network hop on close, no DOM remount.

**5. Move “Manage template gallery” into the account menu.** The header link at `/templates` (`.gallery-title` row) must be **removed**; add a menu item **“Manage template gallery”** inside the account dropdown (the `dropdown-menu` with Projects/Library/Templates/Account settings/Manage/Theme/Log Out) **directly above the `Manage` submenu button**. Visibility: only for **site admins OR template gallery admins** (`flags.canManageTemplates` or `templates.allUsersCanManageTemplates` or `isUserSiteAdmin`) — gate in `account-menu-items.tsx` via existing exposed settings, target URL `/templates/manage`. Remove the old header link + its i18n usage where orphaned.

**6. `/admin/site` → Templates: delete the duplicated “Template bundles” block.** It already exists at `/templates/manage` (shared `TemplateBundles` component). Remove the bundle table/import buttons from the Templates tab of `site-settings-page.tsx` (keep the tab: gallery enable/categories/all-users/admins), replace with a one-line pointer to `/templates/manage`.

**7. `/admin/user` → Update account modal shows stale “Template gallery admin” state.** After revoking on one row, reopening the modal for another user (or re-opening after save) can still show the checkbox `checked` although it functionally changed. Fix: (a) server — `GET /admin/users/<id>` (or user list endpoint) must always return the **current** `flags.canManageTemplates` (check projection/`_formatUser`), (b) modal — re-fetch the specific user on open (or refresh list after save) instead of relying on the cached row from the initial list render. Add a repro test in CDP (revoke → reopen modal → must be unchecked).

**8. Login page: `- suppressNavbarRight = true`** from `davrot/overleaf-cep` commit `6a0aaabad2df45276fe6bca1e20188aeff158812`, file `services/web/app/views/user/login.pug` (line 5). Fetch that line/patch (via the raw URL the user provided) and add it to our `login.pug` — with the caveat the user noted: *the amount of navbar tabs matters* → verify visually that with our tab count the right navbar area stays clean (no orphan gap), adjust if needed. Apply in both `login.pug` and, if present, `register.pug` (check what that commit touched: only login.pug per the user).

### 7.2 Six new `/admin/site` tabs (items 9–12 + second 11 + 12) — each: new site-settings section (env seed → stored wins, secrets encrypted) + tab + i18n + validator; all reuse the SSO tab machinery (`useSave`, masking, `SiteSettingsManager` pattern)

> Naming convention: section id = kebab-case tab name; tab label i18n keys `adminSite.<tab>`; enable + fields + per-tab Save; each tab lists the env variables it now replaces (as a hint line), so admins understand the migration.
>
>> **Note on `SERVER_PRO`**: it is a **historical upstream value that some CE+ extensions still require to be `true`** (sandboxed compiles & friends) — so it **stays as fixed env `SERVER_PRO: true` in compose.yaml** and is **never an admin option**. **Everything else is admin-managed** (confirmed D1): `DOCKER_RUNNER` is **not fixed** — it depends on whether the user wants sandboxed compiles (part of the enable group); `DOCKER_SOCKET_PATH` and the docker.sock **volume mount are environment-specific** (depend on the specific installation) → admin-managed path + the compose volume mount documented/required per installation, never assumed as a universal constant.

**9. Sandboxed Compiles tab** — manages the **exact block this deployment uses today** (from `/data_1/docker/compose_cep/overleafserver/compose.yaml`, lines 85–102), section `sandboxed-compiles`:

*Fixed prerequisite — stays in compose.yaml, NOT admin-editable:* **`SERVER_PRO: true` only** (shown as read-only info on the tab with the “required by CE+ extensions” note). **Environment-specific (admin-editable, seed from the current compose, never assumed):** `DOCKER_SOCKET_PATH` (seeded `/var/run/docker.sock`) — the tab must show a hint that the matching docker.sock **volume mount** in compose is installation-specific and must match this path; `DOCKER_RUNNER` (seed `true`) — belongs to the enable group below.

*Enable group (one “Enable sandboxed compiles” checkbox drives all four, seeded from compose values):* `SANDBOXED_COMPILES: true`, `SANDBOXED_COMPILES_SIBLING_CONTAINERS: true`, `SIBLING_CONTAINERS_ENABLED: true`, **`DOCKER_RUNNER: true`**.

*Admin-editable fields:* host dir (one value written to **both** `SANDBOXED_COMPILES_HOST_DIR` and `COMPILES_HOST_DIR`, seeded from the current value `/data_1/docker/compose_cep/overleafserver/data/data/compiles`), **`DOCKER_SOCKET_PATH`** (`/var/run/docker.sock`), `TEX_COMPILER_EXTRA_FLAGS` (e.g. `-shell-escape`), `TEXLIVE_IMAGE_USER` (seeded `www-data`).

*Image table (the user’s “two-column row table”):* one row per **pair** `[ image, friendly name ]` (index-aligned, as `ALL_TEX_LIVE_DOCKER_IMAGES` / `ALL_TEX_LIVE_DOCKER_IMAGE_NAMES` are), seeded with:

| Image | Name |
|---|---|
| `texlive/texlive:latest-full` | `TeXLive 2025` |
| `texlive/texlive:TL2024-historic` | `TeXLive 2024` |
| `texlive/texlive:TL2023-historic` | `TeXLive 2023` |

Table behavior: **add row** (image + name inputs), **remove row** (per-row button, disabled when only 1 row remains), per-row **“default”** radio implementing `TEX_LIVE_DOCKER_IMAGE` (seeded `texlive/texlive:latest-full`), validation: ≥1 row, unique non-empty images, default ∈ rows, name auto-falls-back to the image tag when empty. Save serializes both comma lists (trim, order-preserved) + `TEX_LIVE_DOCKER_IMAGE`.

*Runtime resolution:* audit all consumers — `server-ce/config/settings.js:275` (`currentImageName: process.env.TEX_LIVE_DOCKER_IMAGE`), `services/web/app/src/Features/Compile/ClsiManager.mjs:1135` (`process.env.TEX_COMPILER_EXTRA_FLAGS`), and the docker-runner/sibling compile code paths for `SANDBOXED_COMPILES*`/`SIBLING_CONTAINERS*`/host dir — replace each with the site-settings resolver (stored → env seed fallback) so admin values win **live where read per request**, with an “applies after restart” hint on fields consumed at boot. Migration scripts (strip/add image repo prefix) stay documented as manual steps.

**10. Git Integration tab** — env to migrate: `GIT_BRIDGE_ENABLED: true`, `GIT_BRIDGE_HOST: git-bridge`, `GIT_BRIDGE_PORT: 8000` (section `git-integration` `{ enabled, host, port }`; host/port stay editable — the container name is deployment-specific; the git-bridge **container + network link stay compose-level**). `SERVER_PRO` remains a fixed prerequisite (note above) — never an option here.

**11. (a) GitHub Synchronization tab** — env: `GITHUB_SYNC_ENABLED`, `GITHUB_SYNC_CLIENT_ID`, `GITHUB_SYNC_CLIENT_SECRET` (**secret → encrypted + masked**, like Zotero), plus optional token-cipher overrides `GITHUB_TOKEN_CIPHER_FILE|PASSWORD|LABEL` / `TOKEN_CIPHER_FILE|PASSWORD|LABEL` shown as an advanced/optional group with the file-format hint (`cipherLabel`, `-v3` suffix rule). Section `github-sync` `{ enabled, clientID, clientSecret, cipherFile?, cipherLabel? }`. Tab text: callback URL to register in the OAuth app = `https://psintern.neuro.uni-bremen.de/user/github-sync/oauth2/callback`; keep the CE+ limitation notes (large repos, symlinks, linked files) as a short help link.

**11. (b) eMail settings tab** — **port the fe4ceb6 `admin/email*` code**: `EmailAdminController.mjs`, `EmailAdminRouter.mjs` logic (NOT their separate `/admin/email` page — fold into a tab), and `emailConfigLoader.mjs` (cache + `_migrateFromEnv` pattern) adapted to our `site_settings` section `email`: `{ fromAddress, replyTo, driver: 'smtp'|'ses', smtp: { host, port, secure, ignoreTLS, name, logger, user, pass (SECRET), tlsRejectUnauth }, ses: { accessKeyId, secretKey (SECRET), region } }`. Env seeds = `Settings.email` (i.e. `OVERLEAF_EMAIL_*`). Same secret/mask/empty-keeps semantics. Validation: port their validators from `SSOAdminController` defaults.

**12. (a) Pandoc Conversion tab + CE+ build files** — env: `ENABLE_PANDOC_CONVERSIONS`, `PANDOC_IMAGE` (section `pandoc` `{ enabled, image }`). **Additionally integrate the CE+ build artifacts** from `davrot/overleaf-cep` commit `1c8fce0182e051b2ed81a008f2eaff9f038cb26a`: `server-ce/Dockerfile-pandoc` (raw URL provided) + the corresponding `server-ce/Makefile` changes (pandoc image build target) — this replaces the “build your own image” wiki instructions; afterwards the tab only needs to configure `PANDOC_IMAGE` (default `pandoc-ol:3.10.0.0`) and the build produces `pandoc-ol` locally. Verify `docker build` of the new Dockerfile inside `server-ce` during the SSO build step.

**12. (b) Linked File Types tab** — env to replace: `ENABLED_LINKED_FILE_TYPES` (currently `project_file,project_output_file,url,zotero`). **Recon step first: enumerate ALL valid linked file types** in CE+ (search `settings.defaults.js`, `Features/LinkedFiles`, git-bridge/github modules, CE+ docs for e.g. `git`, `github`, `s3`, `dropbox`…) — the tab is a **table with one checkbox per available type** (name + one-line description) + a single Save button that PUTs the whole list as `enabledLinkedFileTypes` (section `linked-file-types` `{ enabledTypes: string[] }`). UI validation: at minimum `url` or none allowed (decide); disabling `zotero`/`github` etc. must take effect at runtime (settings-driven, no restart) — verify the linked-file-type read path uses Settings lookup per request (adjust if it is boot-cached).

### 7.3 Cross-cutting for §7.2
- All new tabs go into `ManageSidebar` SECTIONS in the same order: Templates, Zotero, External URLs, Sign up, SSO SAML, SSO OIDC, SSO LDAP, **Sandboxed Compiles, Git Integration, GitHub Sync, E-mail, Linked File Types, Pandoc** (order adjustable; keep SSO trio together with SAML first).
- Unit tests: one new test per section in `site-settings.test.mjs` (validator + secret masking + empty-keeps) — target suite ≥ 490 green before build.
- Lint touched files `--max-warnings 0`; i18n in BOTH `locales/en.json` and `frontend/extracted-translations.json`.
- Live verification per tab: enable → Save → feature visibly active (e.g. linked file type appears in file tree menu; GitHub sync link shows in project menu) → disable → Save → gone. Capture with CDP.
- One final build + deploy + commit for the whole R9 round (single-deploy preference).

### 7.4 **Env removal from compose.yaml (standalone proof)** — required by the user: after every tab above is in place and working, **strip the migrated env vars from `/data_1/docker/compose_cep/overleafserver/compose.yaml`** so the deployment is provably standalone (config source = site settings, not docker env).

Migration table (env → section; values are captured from compose into the stored section **first**, verified, then the env line is deleted):

| compose env (line) | Admin section | Fixed (STAYS in compose) |
|---|---|---|
| `SERVER_PRO: true` (85) | — | ✅ **fixed prerequisite (only env that stays)** — CE+ extensions require it true |
| `DOCKER_RUNNER: true` (86) | `sandboxed-compiles`.enabled (enable group) | — (admin decision: sandbox compiles on/off) |
| `DOCKER_SOCKET_PATH` (89) | `sandboxed-compiles`.socketPath (admin field, install-specific) | the docker.sock **volume mount line stays** (installation-specific mechanism; tab path must match it) |
| `SIBLING_CONTAINERS_ENABLED` (88), `SANDBOXED_COMPILES` (91), `SANDBOXED_COMPILES_SIBLING_CONTAINERS` (92) | `sandboxed-compiles`.enabled | — |
| `SANDBOXED_COMPILES_HOST_DIR` (95), `COMPILES_HOST_DIR` (96) | `sandboxed-compiles`.hostDir (one value → both) | — |
| `ALL_TEX_LIVE_DOCKER_IMAGES` (98), `ALL_TEX_LIVE_DOCKER_IMAGE_NAMES` (99), `TEX_LIVE_DOCKER_IMAGE` (100) | `sandboxed-compiles` image table + default | — |
| `TEX_COMPILER_EXTRA_FLAGS` (101), `TEXLIVE_IMAGE_USER` (102) | `sandboxed-compiles`.extraFlags / .imageUser | — |
| `ENABLE_PANDOC_CONVERSIONS` (23), `PANDOC_IMAGE: sharelatex/sharelatex-pandoc:6.2.0` (24) | `pandoc` | — |
| `GIT_BRIDGE_ENABLED/HOST/PORT` (30–32) | `git-integration` | container + network link stay compose-level |
| `ENABLED_LINKED_FILE_TYPES` (42) | `linked-file-types` — **`project_file`+`project_output_file` fixed on (locked rows)**, `url` + rest toggleable (D5) | — |
| `EMAIL_*` (51–59) once the email tab exists | `email` (pass = encrypted) | `EMAIL_CONFIRMATION_DISABLED` (44) → `email`.skipConfirmation (D6) |
| `EXTERNAL_AUTH: oidc` (66) | — remove entirely (D7: SSO is purely admin-managed, **no env fallback**) | — |
| `GITHUB_SYNC_ENABLED/CLIENT_ID/CLIENT_SECRET` (145–147) | `github-sync` (secret encrypted) | — |

Procedure per section: (1) PUT the current values into the section (or via the tab UI, as an admin would), (2) edit compose.yaml to delete the lines (keep **only** `SERVER_PRO` + the docker.sock volume mount line), (3) `down/up overleafserver` (env is process-level → removal only takes effect on the next cycle — this is where it lands), (4) verify the features still work (SSO logins, a sandboxed compile in a test project, a git-bridge clone, linked file types, zotero/github flows) and (5) `grep` the compose file to prove the lines are gone. **Rollback**: the env values are in compose git history — re-adding the lines + one cycle restores the old state.

### 7.5 Decision list (FINAL — user-confirmed 2026-08-29)
- **D1 ✓** Fixed-in-compose set = **`SERVER_PRO` ONLY**. `DOCKER_RUNNER` (depends on whether the user wants sandboxed compiles) and `DOCKER_SOCKET_PATH` + socket volume (installation-specific) all migrate to the tab / are install-specific.
- **D2 ✓** Boot-time-consumed fields (image table, host dir, image user, DOCKER_RUNNER, socket path) change on the **next container cycle** — tab shows an “applies after restart” hint on those; per-request-consumed ones (compile flags, linked file types, SSO, linked files) are live. No container auto-restart from the UI (the cycle is a manual step).
- **D3 ✓** GitHub OAuth credentials (`Ov23li…` / `5d8732…`) move into the **encrypted** `github-sync` section, then env is stripped (zotero-secret pattern).
- **D4 ✓** Image-table semantics: (image, name) **index-aligned pairs**; default ∈ rows; remove-row removes both; name optional (fallback = image tag).
- **D5 ✓** Linked file types: **`project_file` + `project_output_file` are FIXED (always on, locked in the UI)**; `url` and everything else (zotero, …) are toggleable. Validator: stored list always includes `project_file,project_output_file`; `url` is NOT enforced.
- **D6 ✓** `EMAIL_CONFIRMATION_DISABLED: true` → “Skip email confirmation” checkbox on the E-mail tab, then env stripped.
- **D7 ✓** `EXTERNAL_AUTH` (and all `OVERLEAF_SAML_*/OIDC_*/LDAP_*` env) are **removed and NOT a fallback**: SSO configuration is **purely stored in site settings** — there is **no env-seed fallback for fresh installs** in SSO (unset section ⇒ provider disabled). The env branches in the fe4ceb6 managers are inert in our integration (the loader only resolves stored sections; no env seed for the SSO trio).

### 7.6 Scheduling note
Items 1–8 are small and independent — do them in the **same session** as SSO Phases 5–7 (they all land in the one build14). Items 9–12 (six tabs + pandoc build files + email port) are a **second commit/round** after SSO is live-verified, because they expand the admin surface and need their own live matrix.

## 8. Intensive bug hunt (final gate — AFTER ALL of SSO + R9 are done, deployed, and live-verified)

A dedicated regression/security sweep of the **entire** surface we touched (bib editor, ORCID/Zotero, templates, admin console incl. all new tabs, SSO, signup/email/linked files) against the live instance. No new features in this phase — only finding & fixing.

**8.1 Scope (per area, each in a FRESH CDP profile + a non-admin profile `notadmin@`)**
- **SSO**: enabled/disabled combinations of all three at once (on+on+on, one on, all off); wrong-credential paths at each IdP; disabled provider login attempts via direct URL (`/saml/login`, `/oidc`, `/auth/ldapauth`) must 403/fail cleanly; IdP unregistered → no crash; logout round-trips incl. SAML SLO + OIDC end-session; new-user creation emails confirmed + `hashedPassword` unset; admin-attribute paths (is_admin) do NOT make non-site-admins site admins; concurrent logins with the **same** email from two SSO users (user collision handling); session fixation: login cookie rotate (check `SessionManager`); `user.externalAuth` persisted; rate-limit middleware still active (LDAP).
- **Templates**: gallery on/off toggles reflected immediately (login page, sidebar, `/templates/manage` guard, `ensureGalleryEnabled` 404s); category publishable toggles; bundle import: malformed zip, nested zips, name conflict 409 + override→bump, SSRF allowlist (blockedNetworks still enforced); template-admin revocation blocked for site admins (item 3); non-admins cannot reach `/templates/manage` or admin API (403) — test as `notadmin@`.
- **Admin console**: every tab Save/Cancel round-trip in BOTH profiles; **non-admin must get 403 on all `GET/PUT /admin/site-settings/*`** (enumerate sections: templates, zotero, externalUrl, signup, sso-*, and all six R9 sections); secret masking on GET for every secret field; empty-secret keeps stored value; admin user cannot lock themselves out of template admin (site admin) AND cannot be stripped of site admin; user list create/update/delete incl. restoring; search/filter edge cases (unicode, empty, injection strings `\u0000` etc.).
- **Bib editor + library**: panel & library parity (item 1), resizer (item 2) incl. double-click reset, resize with preview closed/open, both themes, mobile width; visual→code cursor sync; entry add/edit/dedup (500 regression from R5); bulk select; search/filter; import .bib/.ris; `/library` with 0/1/50 entries; panel in RTL locale (de) spot-check.
- **Linked files + Zotero + ORCID**: linked file types toggled off → menu entry gone + existing links still open (read path unaffected); re-enable; Zotero link/unlink + picker (My Library/groups); ORCID iD + picker; both with `notadmin@` (allowed) and disabled state.
- **Signup/email (new tabs)**: signup on/off + allowed domains (accept + reject cases incl. subdomain semantics), disabled redirect; with the email tab saved: passwordless-login mail path — smoke test the email job without real sending (log check only; SMTP not reachable in this env — verify no 500 and the driver fallback).
- **GitHub/Git/compiles (new tabs)**: toggles flip exposed settings only (no crash); when disabled, project-level features hidden (no JS errors, `ol-ExposedSettings` consistent); enable pandoc without the image present → clean error, app healthy.

- **Sandboxed compiles after env-strip (post-§7.4)**: compile a real project in a sandboxed sibling container (test project `6a9040356aa8b01a4826e198`, or a minimal `main.tex` project) — success + output artifact; switch the **default image** via the new table (e.g. TeXLive 2024) → recompile (applies after the planned cycle in D2); `TEX_COMPILER_EXTRA_FLAGS -shell-escape` path (minted) if available.

**8.2 Cross-cutting checks (evidence-based, not ad-hoc)**
- **Console sweep**: automated CDP script over every public/admin page (login, register, project, editor, library, /templates, /templates/manage, /admin/site ×12 tabs, /admin/user, /user/settings, Z/linked file modals) collecting `console error/warn` + failed network (≥400) — zero new errors vs a clean baseline.
- **Security**: CSRF on every new/changed mutating endpoint (missing `X-Csrf-Token` → 403); auth on every admin endpoint (no session → 401/403) incl. the new SSO section endpoints; IDOR spot-checks (project/template/user ids from other users); XSS injection attempts into new text fields (email from/to, image names, bundle names, SSO identityServiceName) — must be HTML-escaped server-side or by React; secrets never in GET responses, `res.locals`, logs (grep `docker logs overleafserver` after a save for any secret substring); `Content-Security-Policy`/clickjacking headers unchanged on new routes; brute-force: repeated bad SSO/LDAP logins (rate limit still works).
- **Data integrity**: after enabling SSO + toggles: `db.site_settings` document shape sanity (no stray fields, `version` bumped per save), `db.users` flags consistent, no orphan `templates` rows, no duplicate `_id: 'sso-settings'`-style docs (we do NOT create them — assert absent), no leak of env values into stored settings when stored is empty (GET shows mask only).
- **Perf sanity**: admin page first load < 3 s, login page < 2 s, no N+1 in template list with 13 categories, editor unchanged vs baseline (Lighthouse-free: time-based spot check via CDP `performance.timing`).

**8.3 Method & exit criteria**
- Each bug: **repro script** saved to `/tmp/bughunt/NN-<name>.mjs` (CDP) or curl, with the failing evidence (status/HTML/console). Fix → add/extend a **unit test** when testable (target suite still ≥ 490 green) → re-run the repro script → re-run §8.2 affected checks.
- **Exit criteria**: §8.1–§8.2 fully run in BOTH profiles (admin + non-admin), zero open P0/P1, P2 logged with a decision (fix-now or accept-with-note), final `make all` + deploy + full SSO/SSO-matrix quick re-verify (3 logins OK) + unit suite green + lint clean.
- Deliverables: `BUGHUNT_REPORT.md` (table: id, area, severity, repro, root cause, fix commit, verification) + commit message listing fixes; push `bib-editor`; close TODOs; memory notes for non-obvious regressions (failure target).

**8.4 Order**: 8.1 per-area sweeps → 8.2 cross-cutting → fix loop (max 3 iterations, then escalate with the report) → final deploy + report. Estimated: 1 focused work session; parallelize the CDP sweep scripts via a `subagent` run (`runs.all`) only if the single session exceeds ~2 h.
