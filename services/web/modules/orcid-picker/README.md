# orcid-picker

Fork module (not upstream Overleaf): the "Import from ORCID.org" picker —
search by ORCID iD or author name, list an ORCID's works, select any
subset, and import their citation data as BibTeX entries.

## Where it plugs in

- Add menus (shared entry points, added 2026-08-28):
  - **Project** → BibTeX editor → `+ Add → Import from ORCID.org`
    (`modules/bib-editor/.../bib-entry-list.tsx`; append handled by
    `bib-editor-panel.tsx`, all-or-nothing key collision rejection).
  - **Library** → top bar `+ Add → Import from ORCID.org`
    (`modules/bib-editor/.../library/library-page.tsx`; new-only REST
    insert).
- Server: `app/src/OrcidPickerRouter.mjs` (login-required)
  - `GET /orcid-picker/search?q=` — ORCID public search (iD or name)
  - `GET /orcid-picker/works?orcid=` — work list (title, year, type, put-code)
  - `GET /orcid-picker/fetch-bib?orcid=&putCodes=…` — per-work BibTeX
    fetched from `https://pub.orcid.org` server-side.
- Service: `app/src/OrcidService.mjs` — hardened vs the legacy
  `old-doi-orcid-picker` implementation:
  - hop-by-hop SSRF guard (`redirect: 'manual'` loop, max 5 hops,
    `isPrivateAddress` per hop incl. IPv4-mapped IPv6, ULA `fc00::/7`,
    CGNAT `100.64.0.0/10`, link-local, multicast, broadcast)
  - 10 s timeout, 2 MB body cap, DOI shape sanity check
  - `buildBibtexFromOrcidWork` — ORCID work → BibTeX field mapping
    (used when a work has no embedded BibTeX)
- Frontend: `frontend/js/components/orcid-picker-modal.tsx`
  (two-step modal: search → works; `OL*` design-system components; i18n
  keys in `locales/en.json`; import worker pool of 4 with live
  `Importing __done__ of __total__…` progress — note this codebase's
  i18next uses `__var__` interpolation, **not** `{{var}}`).
- Import key hygiene: `normaliseOrcidEntryKeys` (shared
  `modules/bib-editor/frontend/js/utils/bib-import.ts`) regenerates
  illegal citation keys (ORCID-embedded BibTeX can carry URL-style
  keys) to the legal charset `[A-Za-z0-9._-]{1,128}` and de-dupes
  within a batch — required by the library REST, harmless for the
  project `.bib` editor.

## Tests

`test/unit/src/orcid-service.test.mjs` (offline: iD validation,
`isPrivateAddress`, BibTeX mapping, input guards) and
`modules/bib-editor/test/unit/src/orcid-keys.test.mjs` (key
normalisation).

## Registration

`index.mjs` exports `{ router }`; registered in
`config/settings.defaults.js` → `moduleImportSequence` between `zotero`
and `bib-editor`.
