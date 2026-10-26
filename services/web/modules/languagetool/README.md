# LanguageTool module

Grammar and style checking in the Overleaf source editor, powered by an
external [LanguageTool](https://languagetool.org) server (API v2).

Based on the upstream PR:
<https://github.com/yu-i-i/overleaf-cep/pull/179> (commit 8337e00), adapted
for ext-ce-v6.3.1 with:

- **Picky level as the default** and an on/off "Picky mode" toggle in the
  project settings (the deployed LT fork, `erikvl87/languagetool`, supports
  `default` + `picky`; other levels return HTTP 400).
- **Project-wide settings** (stored on the project document, shared by all
  collaborators, synced over the editor socket):
  - `languageToolEnabled` — grammar check on/off (default: on)
  - `languageToolPicky` — picky level on/off (default: **on** → `level=picky`)
  - `languageToolLanguage` — LT language code, e.g. `en-US`, `de` (default: `auto`)
- **Dark/light theme support**: tooltip + underlines use the Overleaf themed
  CSS variables (`--bg-primary-themed`, `--content-primary-themed`, ...)
  with light-mode fallbacks (fixes the dark-theme tooltip bug from the PR).

## Server (Overleaf) environment

| Variable                | Default           | Notes                                   |
| ----------------------- | ----------------- | --------------------------------------- |
| `LANGUAGE_TOOL_ENABLED` | _unset_           | must be exactly `true` to activate      |
| `LANGUAGE_TOOL_HOST`    | `languagetool`    | host of the LT service                  |
| `LANGUAGE_TOOL_PORT`    | `8010`            | LT API port                             |
| `LANGUAGE_TOOL_URL`     | derived           | overrides host+port when set            |

The overleaf container needs network access to the LT service. In this
deployment the overleaf service joins the external
`languagetools_server_compose_default` network (see
`/data_1/docker/compose/overleaf/compose.yaml`) and talks to
`http://languagetool:8010`.

## Endpoints (authenticated)

- `GET /languagetool/languages` — LT language list (used by the settings UI)
- `POST /languagetool/check` — JSON body `{ language, level?, text? | data? }`;
  proxied to LT `/v2/check` with a 100 KB cap and LaTeX-noise `disabledRules`.
  **Exempt from CSRF** (`webRouter.csrf.disableDefaultCsrfProtection` in the
  router): it is a stateless, login-gated query — and long-lived editor tabs
  outlive session rotations, where the page's meta token would stale out and
  403 every check. The client still sends `X-CSRF-Token`; it passes when the
  session is fresh.

## Frontend

- `frontend/js/languagetool-extension.ts` — CodeMirror 6 extension
  (wired via the `sourceEditorExtensions` slot in
  `services/web/config/settings.defaults.js`). Wavy underlines + hover
  tooltip with replacement buttons; LaTeX-aware annotation via the Lezer
  syntax tree (regex fallback); debounced 2 s; aborts stale requests;
  filters TYPOS while the Hunspell spellchecker is active.
- `frontend/js/languagetool-section.tsx` +
  `frontend/js/components/languagetool-settings.tsx` — Settings modal,
  Spelling and Language → **LanguageTool** (wired via the
  `settingsModalSpellcheckSections` slot).

Settings reach the editor through `options.languageTool`
(`use-codemirror-scope.ts`) and the `lt:settings-changed` window event.

## Files

```
index.mjs                                  module entry (env-gated router)
app/src/LanguageToolRouter.mjs
app/src/LanguageToolController.mjs
frontend/js/languagetool-extension.ts
frontend/js/languagetool-section.tsx
frontend/js/components/languagetool-settings.tsx
frontend/js/utils/latex-to-annotations.ts
```

Core Overleaf changes (see git diff):

- `services/web/config/settings.defaults.js`
  (`sourceEditorExtensions`, `settingsModalSpellcheckSections`,
  `moduleImportSequence`)
- `services/web/app/src/infrastructure/ExpressLocals.mjs`
  (exposed setting `languageToolAvailable`)
- `services/web/types/exposed-settings.ts`
- `services/web/app/src/Features/Project/ProjectController.mjs`
  (project-settings schema + update)
- `services/web/app/src/Features/Project/ProjectOptionsHandler.mjs` (persist)
- `services/web/app/src/Features/Editor/EditorController.mjs` (socket emit)
- `services/web/frontend/js/features/ide-settings/...` (settings UI context,
  hooks, socket listener, `api.ts`)
- `services/web/frontend/js/features/source-editor/hooks/use-codemirror-scope.ts`
