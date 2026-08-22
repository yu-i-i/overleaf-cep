# LLM module for Overleaf Community Edition

Bring your own LLM endpoints (BYO) plus a site-wide shared backend into the
project editor: selection-based **Ask AI** toolbar, a **chat rail**, **inline
completion**, whole-document **generators** (title / abstract / keywords), and
**rubric-based compliance reviews**.

## Provider stack (Vercel AI SDK)

All model calls go through one seam — `app/src/LLMClient.mjs` — built on the
Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`,
`@ai-sdk/openai-compatible`). Three provider types:

| Type                 | Adapter                 | Use for                                              |
|----------------------|-------------------------|------------------------------------------------------|
| `openai`             | `@ai-sdk/openai`        | api.openai.com (or any override base URL)            |
| `anthropic`          | `@ai-sdk/anthropic`     | api.anthropic.com (or any override base URL)         |
| `openaiCompatible`   | `@ai-sdk/openai-compatible` | Ollama, vLLM, llama.cpp, academiccloud, OpenRouter, any OpenAI-style `/v1` server |

Structured outputs (compliance reviews) use `generateObject`; backends that
cannot do strict structured output fall back to plain JSON + a tolerant parser
with retries. Reasoning ("thinking") models are supported; empty answers where
the budget was spent on thinking are surfaced as a clear `empty-response`
error.

## Lanes

Every LLM call runs on one of two lanes, resolved from the **model id**:

- **Site lane** — bare model id (e.g. `qwen3.8:latest`), the admin-configured
  backend. Explicit model ids must be in the admin `allowedModels` list.
- **User lane** — namespaced id `u:<rowId>:<model>`, one of the user's BYO
  provider rows. The user's own credentials are used.

A request **without** a model resolves to the user's first enabled BYO row (if
BYO is allowed), else the site default.

## Endpoints

All chat/completion/generation endpoints are project-scoped (read permission);
settings are user- or admin-scoped.

| Method | Path                                        | Purpose                              |
|--------|---------------------------------------------|--------------------------------------|
| POST   | `/project/:id/llm/chat`                     | Chat (Ask AI rail + toolbar)         |
| GET    | `/project/:id/llm/models`                   | Site models + user provider rows     |
| GET    | `/project/:id/llm/features`                 | Per-feature enable flags             |
| GET    | `/project/:id/llm/source-context`           | Source window around a compile error |
| GET    | `/project/:id/llm/prompts`                  | Effective editable prompts           |
| POST   | `/project/:id/llm/completion`               | Inline completion                    |
| POST   | `/project/:id/llm/generate`                 | Title / abstract / keywords          |
| GET    | `/project/:id/llm/compliance/rubrics`       | Configured rubrics                   |
| POST   | `/project/:id/llm/compliance/start`         | Start a review job                   |
| GET    | `/project/:id/llm/compliance/status/:jobId`| Poll a review job                    |
| POST   | `/project/:id/llm/compliance/cancel/:jobId`| Cancel a review job                  |
| GET    | `/user/llm-providers`                       | List BYO rows (keys masked)          |
| POST   | `/user/llm-providers`                       | Add a BYO row                        |
| POST   | `/user/llm-providers/:id`                   | Update a BYO row                     |
| POST   | `/user/llm-providers/:id/delete`            | Delete a BYO row                     |
| POST   | `/user/llm-providers/check`                 | Test an existing row or draft        |
| POST   | `/user/llm-providers/scan`                  | List models served by a backend      |
| GET    | `/admin/llm/settings` (+ `/json`)           | Site backend settings page/API       |
| POST   | `/admin/llm/settings`                       | Save site backend settings           |
| POST   | `/admin/llm/settings/check`                 | Connection test (model list fetch)   |
| POST   | `/admin/llm/models`                         | Scan the site backend for models     |

* `GET /user/llm-settings` — dedicated BYO settings page (provider table,
  Test/Model scan, Add/edit). Linked from the Account menu.
* Admin settings UI: **Manage Site → “LLM Configuration” tab**
  (`/admin`), served by the standalone page `GET /admin/llm/settings`.
  There is intentionally **no separate navbar entry** (reviewer requirement).

## Environment variables

| Variable                   | Default          | Meaning                                             |
|----------------------------|------------------|-----------------------------------------------------|
| `LLM_ENABLED`              | `true` if `llm.enabled !== false` | Loads the module at all |
| `LLM_API_URL`              | —                | Fallback site backend base URL (admin file wins)    |
| `LLM_API_KEY`              | —                | Fallback site backend key                           |
| `LLM_MODEL_NAME`           | —                | Fallback default model (comma list for several)     |
| `LLM_AVAILABLE_MODELS`     | —                | Fallback allowed model list                         |
| `LLM_API_TYPE`             | auto-detect      | Fallback provider type (`openai`/`anthropic`/`openaiCompatible`) |
| `LLM_ALLOW_USER_SETTINGS`  | **off**          | `'true'` enables BYO rows (all user endpoints 403 otherwise) |
| `LLM_KEY_SECRET`           | —                | Secret for encrypting stored API keys (AESCrypt, `enc:v1:`). **Set it** — without it keys are stored in plaintext. |
| `LLM_ADMIN_SETTINGS_PATH`  | `/var/lib/overleaf/data/llm-admin-settings.json` | Site settings file |
| `LLM_USER_RATE_PER_MINUTE` | `60`             | Per-user LLM calls per rolling minute               |
| `LLM_USER_DAILY_TOKENS`    | `1000000`        | Per-user output-token budget per UTC day            |
| `LLM_REVIEW_MAX_TOKENS`    | `12000`          | Review answer budget                                |
| `LLM_REVIEW_MAX_PASSES`    | `200`            | Max review passes per job (per-file caps include)   |

## Security notes

- BYO endpoints are gated on `LLM_ALLOW_USER_SETTINGS` in **every** handler
  (router registration is unconditional; disabled deployments answer `403`).
- Site-lane model ids are validated against the admin allowlist server-side.
- API keys are encrypted at rest when `LLM_KEY_SECRET` is set (never returned
  to the browser, only `hasKey`).
- LLM output is rendered through `marked` + `DOMPurify` (sanitized) in the
  chat rail and selection toolbar.
- Per-user rate + daily token guards protect the shared backend from
  runaway usage (inline completion is the high-frequency path).
- Review jobs are capped: per-user in-flight limit, global queue limit, and a
  hard pass budget per job.

## Legacy import (upgrade path)

Users of the previous single-backend design stored `llmApiUrl`/`llmApiKey`/
`llmModelName` (+ `llmApiType`) on the user document. On the first
`loadProviders()` call, that configuration is **materialized once** into
`llmProviders[0]` — an `id: 'legacy'` row named **“Imported settings”**
(`enabled: true`) with the key **encrypted at rest** — and served under its
`legacy` id from then on. The legacy fields are left untouched, so a rollback
deep-links the same data. Users who already have provider rows are not
affected.

## Error surfacing for failed connections

`check`/`scan` and admin saves surface *specific* failures:

- Provider 401/403 → `HTTP 401` with a human message ("provider rejected
  the key / no key provided", provider detail included when the backend
  returns one). The UI shows that message in the connection notice.
- Admin settings save → `400 {ok:false, error, errors:[{field,message}]}`
  (all zod issues), shown as a banner next to the Save button.
- Rubric scan regexes are validated by `safeRubricRegex` (rejects recursive
  groups and repeated-quantifier patterns) to keep reviews from hanging.

## Tests

```bash
node --test services/web/modules/llm/app/test/llm-client.test.mjs   # offline unit tests
node --test services/web/modules/llm/app/test/llm-crypto.test.mjs   # key-encrypt roundtrip + legacy plaintext
node services/web/modules/llm/app/test/LLMClient.live.mjs           # live smoke (needs a reachable backend)

# Frontend render regressions (jsdom; needs the standalone harness config):
cd services/web
NODE_ENV=development <node_modules>/.bin/vitest run --config vitest.llm-frontend.config.js
```

Deployed-container verification (bash/curl driver) covers login, site/user
lanes, BYO CRUD + check/scan, rate-guard burst, compliance job lifecycle,
and the settings pages: 12/12 passing on the latest build.

## Reviewer compliance (issue #222, remaining items)

- **#5 auto-detect API type** — `POST /user/llm-providers/check` and `/scan` try the
  requested type first, then every supported type. A working type different from
  the saved one is returned as `detectedProviderType`, the UI persists it on the
  row (drafts are switched too), and the Test button says "API type auto-set to …".
- **#9 model-list freshness (decided: manual only)** — no automatic background sync
  (removed by owner decision 2026-08-21: timer-based auto-refreshes can replace a
  user-curated model list and surprise users; the benefit was small). Model lists
  are refreshed explicitly: **Test connection** (verifies and returns the current
  list) and **Scan models** (merges the freshly served list into the row).
  Providers whose model roster changes over time are handled with one click of
  Scan — no timers, no background traffic, no rate-limit exposure.
- **#11 split/join** — removed from the editor toolbar (type, labels, modes 5/6;
  the admin prompt templates remain available if ever needed).
- **#13 generators in the File menu** — title / abstract / keywords moved from the
  selection toolbar into the core **File menu** (module extensions
  `frontend/js/extensions/llm-file-menu-*`, core `insertMenuSections` +
  `menubarExtraComponents` in `config/settings.defaults.js`). They read the whole
  project (`POST /project/:id/llm/generate`) — matching the reviewer's point
  that whole-document generators do not belong to a selection context — and open
  a result modal with copy-to-clipboard. Non-LLM deployments see no menu items
  (unregistered commands are filtered by the core menu renderer).
- **#2 user settings inside Account Settings** — the BYO table/editor is rendered
  directly in the core Account Settings page ("AI assistant" section,
  `frontend/js/features/settings/components/llm-user-section.tsx`) via the
  `overleafModuleImports` mechanism (`llmUserSettingsSection`, same pattern as
  the github/zotero widgets — no dual-React risk); the section renders in
  `compact` mode (no duplicate header) and falls back to a link card when the
  module is absent. `/user/llm-settings` remains available as a deep link / the
  Account ▸ 'AI Settings' entry.

## Layout

- `app/src/LLMClient.mjs` — AI-SDK seam (models, chat text/objects, model listing)
- `app/src/LLMModelRef.mjs` — model-ref grammar (`u:<rowId>:<model>`)
- `app/src/LLMBudget.mjs` — per-user rate + token guards
- `app/src/LLMChatController.mjs` — chat / completion / models / generators
- `app/src/LLMSettingsController.mjs` — BYO provider rows (CRUD, check, scan)
- `app/src/LLMAdminController.mjs` — site backend settings, check, scan, prompts
- `app/src/LLMComplianceController.mjs` — rubric review engine (job queue)
- `app/src/LLMCrypto.mjs` — at-rest key encryption
- `app/src/LLMPrompts.mjs` — prompt defaults + merges
- `app/views/*.pug` — page shells (settings, admin)
- `frontend/js/components` — toolbar, chat rail, compliance pane, settings UI
- `frontend/js/hooks` — chat / compliance / features state
- `frontend/js/pages` — webpack entries (`user/llm-settings`, `admin/...`)
- `frontend/stylesheets/*.scss` — module styles
