# Toolkit ↔ /admin/site — env-parameter gap analysis (item 6, 2026-09-01)

Goal (user): *"use the default toolkit, and have everything we differ on
covered by /admin/site, sorted into the right sections."* Assume
`SERVER_PRO=false` (we are CE + our modules). This reports which env
parameters our stack reads, which /admin/site already governs, which the
toolkit owns (leave them to `.env`), and what is still missing — the
candidates for a new **Miscellaneous** section.

## Method
- Full env surface = `process.env.*` read in
  `services/web/config/settings.defaults.js` (144) + our module code under
  `modules/*/app`, `modules/*/src`, `modules/*/index.mjs` (adds 32) = **176 unique**.
- Toolkit surface = the `${VAR}` placeholders consumed by
  `~/junk_bib/toolkit/lib/*.yml` + `bin/*` (107) — these are the infra/deploy
  vars the toolkit's own `.env` sets.
- /admin/site surface = the sections stored via `SiteSettingsController`
  (+ `EnvHydrator` boot-time env overrides) and the 13 tabs in
  `site-settings-page.tsx`.

## 1. Already governed by /admin/site (no action)
| Section (tab) | Env / params it governs |
|---|---|
| Templates | `OVERLEAF_NON_ADMIN_CAN_PUBLISH_TEMPLATES`, `OVERLEAF_TEMPLATES_USER_ID`, `OVERLEAF_TEMPLATE_CATEGORIES` |
| Zotero | `ZOTERO_CLIENT_KEY/SECRET`, `ZOTERO_TOKEN_CIPHER_*` (+ shared `TOKEN_CIPHER_*`) |
| External URLs | `LINKED_URL_PROXY_HOST`, linked-URL allow/deny policy |
| Sign-up | `OVERLEAF_ENABLE_REGISTRATION_PAGE`, `OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS`, `EMAIL_CONFIRMATION_DISABLED`, `RECAPTCHA_ENDPOINT`, `HAVE_I_BEEN_PWNED_*`, `CAPTCHA_TRUSTED_USERS*` |
| SSO SAML / OIDC / LDAP | stored SSO sections (resolved per-request, not boot-hydrated) |
| Sandboxed compiles | `SANDBOXED_COMPILES`, `TEX_LIVE_DOCKER_IMAGE`, `ALL_TEX_LIVE_DOCKER_IMAGES(_NAMES)`, `SANDBOXED_COMPILES_HOST_DIR`, `TEXLIVE_IMAGE_USER`, `TEX_COMPILER_EXTRA_FLAGS`, `DOCKER_RUNNER`, `SIBLING_CONTAINERS_ENABLED` |
| Git integration | `GIT_BRIDGE_ENABLED`, `GIT_BRIDGE_HOST/PORT`, `GIT_BRIDGE_API_BASE_URL` |
| GitHub sync | `GITHUB_SYNC_ENABLED`, `GITHUB_SYNC_CLIENT_ID/SECRET`, `GITHUB_TOKEN_CIPHER_*` |
| E-mail | `ADMIN_EMAIL`, SMTP (`OVERLEAF_EMAIL_*`), `ENABLE_ONBOARDING_EMAILS` |
| Linked file types | `ENABLED_LINKED_FILE_TYPES` |
| Pandoc | `ENABLE_PANDOC_CONVERSIONS` |
| (Dashboard) | `INSTANCE_STATS_ENABLED`, alert config (own `/admin/instance-stats` page) |
| (Global) | `overallTheme` (light/dark/system) |

## 2. Toolkit / infrastructure — intentionally left to the toolkit `.env`
These are deploy-time, not server-behavior; the "default toolkit" owns them
and they must NOT be moved into /admin/site:
`MONGO_*`, `REDIS_*`, `*_HOST` / `*_PORT` (chat, cls, docstore, downloads,
filestore, git-bridge host/port, history, linked-url proxy, notifications,
realtime, v1-history, webpack, web, web-api), `WEBSOCKET_*`, `SESSION_SECRET*`,
`COOKIE_DOMAIN`, `EXPOSE_HOSTNAME`, `PUBLIC_URL`, `TRUSTED_PROXY_IPS`,
`GRACEFUL_SHUTDOWN_*`, `MAX_RECONNECT_*`, `OT_JWT_*`, `I18N_*`, `NODE_ENV`,
`MINIFIED_JS`, `PUG` compile/cache flags, `IS_CODE_SPACE`,
`SMOKE_TEST_USER_ID`, `BCRYPT_ROUNDS`, `DEVICE_HISTORY_SECRET`,
CLSI backend-class selectors, filestore/history S3 buckets, `WEBPACK_HOST`.

## 3. GAP — server-behavior params our code reads that /admin/site does NOT
govern yet. These are the "our differences" the goal says should live in
/admin/site. Proposed **Miscellaneous** section (grouped):

### Branding / SEO
- `APP_NAME` (server name / title) — *verify not already admin-branded first*
- `NAV_HIDE_POWERED_BY` (hide "Powered by")
- `ROBOTS_NOINDEX` (noindex)
- `WIKI_URL` / `WIKI_MAX_CACHE_AGE` (CE help page)

### Access & sharing
- `OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING`
- `OVERLEAF_ALLOW_PUBLIC_ACCESS`
- `OVERLEAF_DISABLE_LINK_SHARING`
- `OVERLEAF_DISABLE_CHAT`

### Lifecycle / retention
- `OVERLEAF_PROJECT_HARD_DELETION_DELAY`
- `OVERLEAF_USER_HARD_DELETION_DELAY`
- `OVERLEAF_HISTORY_RESTORE`
- `ENABLE_PDF_CACHING`

### Limits
- `MAX_UPLOAD_SIZE`
- `MAX_ENTITIES_PER_PROJECT`
- `MAX_JSON_REQUEST_SIZE`
- `COMPILE_BODY_SIZE_LIMIT_MB`

### Compile
- `DEFAULT_LATEX_COMPILER` (default engine — could also fold into Sandboxed compiles)

### Bib library (our module)
- `OVERLEAF_BIB_LIBRARY`
- `OVERLEAF_BIB_LIBRARY_TRASH_RETENTION_DAYS`

### Maintenance / advanced
- `SITE_MAINTENANCE_FILE` / `SITE_OPEN` (maintenance banner)
- `ELEVATED_ACCOUNT_SECURITY_AFTER_FAILED_LOGIN_MS`
- `COMMENT_MENTION_DELAY_MS`
- `RATE_LIMIT_AUTO_COMPILE_STANDARD` / `RATE_LIMIT_AUTO_COMPILE_EVERYONE`
- `SUBNET_RATE_LIMITER_DISABLED`

## Recommendation
SHIPPED (2026-09-01): a **Miscellaneous** tab with the high-value, user-facing subset (14 fields) —
Branding/SEO, Access & sharing, Lifecycle, Limits, Compile default. The niche
rate-limit/mention-tuning knobs and pure-infrastructure group (section 2) stay
in the toolkit `.env` (the bib-library trash-retention field was held back:
it needs a `bibLibrary` settings key that isn't currently defined in
`settings.defaults.js`). Implemented following the existing section pattern:

- `SiteSettingsManager.mjs` — `SECTION_KNOWN_KEYS.misc`, `envSeeds().misc` (seeds
  mirror `settings.defaults.js`), `validateMiscSection`, `SECTION_VALIDATORS.misc`.
- `SiteSettingsController.mjs` — GET returns `misc`; PUT reuses the generic
  per-section validator + `cleanSectionInput`.
- `EnvHydrator.mjs` — boot-time stored→env mapping (deletion delays stored in
  days, hydrated to MS).
- `r9-settings-tabs.tsx` — `MiscTab` component; `site-settings-page.tsx` —
  `misc` Section + tab + render.
- i18n `adminSite.misc*` in `locales/en.json` + `frontend/extracted-translations.json`.
- Tests: `site-settings.test.mjs` misc validator + env-seed cases (admin-tools
  suite 35/35 green, lint clean).

The 14 wired fields:
| Group | Admin field | Env |
|---|---|---|
| Branding | appName | APP_NAME |
| Branding | navHidePoweredBy | NAV_HIDE_POWERED_BY |
| Branding | robotsNoindex | ROBOTS_NOINDEX |
| Access | allowPublicAccess | OVERLEAF_ALLOW_PUBLIC_ACCESS |
| Access | allowAnonymousReadWriteSharing | OVERLEAF_ALLOW_ANONYMOUS_READ_AND_WRITE_SHARING |
| Access | disableLinkSharing | OVERLEAF_DISABLE_LINK_SHARING |
| Access | disableChat | OVERLEAF_DISABLE_CHAT |
| Lifecycle | projectHardDeletionDelayDays | OVERLEAF_PROJECT_HARD_DELETION_DELAY (MS) |
| Lifecycle | userHardDeletionDelayDays | OVERLEAF_USER_HARD_DELETION_DELAY (MS) |
| Lifecycle | historyRestore | OVERLEAF_HISTORY_RESTORE |
| Lifecycle | enablePdfCaching | ENABLE_PDF_CACHING |
| Limits | maxUploadSizeMiB | MAX_UPLOAD_SIZE (MiB) |
| Limits | maxEntitiesPerProject | MAX_ENTITIES_PER_PROJECT |
| Compile | defaultLatexCompiler | DEFAULT_LATEX_COMPILER |
