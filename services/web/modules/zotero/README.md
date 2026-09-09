# zotero

Upstream Overleaf CE module + fork extensions: link a user's personal
Zotero account, create/refresh "Zotero-linked" project files
(references synced from a selected collection), and keep the user's
access tokens (AES-256 via `@overleaf/access-token-encryptor`,
`AccessTokenEncryptorHelper.mjs`).

## Fork changes (`bib-editor` branch)

### Admin-managed on/off (SiteSettings, 2026-08-28)

- `index.mjs` registers the router + linked-file agent
  **unconditionally** (previously boot-gated on
  `ENABLED_LINKED_FILE_TYPES`); the env membership now only feeds the
  SiteSettings seed.
- `app/src/ZoteroSection.mjs`
  - `zoteroSection()` — per-request read of the `zotero` SiteSettings
    section (stored value wins over env; 5 s TTL cache).
  - `ensureZoteroEnabled` — applied to `/user/zotero/oauth` (link flow)
    and `/user/zotero/groups` (create-file modal): OFF → 403.
- New-file creation gate: core
  `app/src/Features/LinkedFiles/LinkedFilesController.mjs` rejects
  `provider === 'zotero'` create calls (403) when the section is OFF.
- **Semantics when OFF:** existing linked files keep working
  (refresh/unlink remain open — `DELETE /user/zotero` +
  `/user/zotero/status` are intentionally ungated); only NEW links and
  NEW linked files are rejected.
- Manage UI: **Account → Manage → Manage Site → Zotero tab**
  (on/off, client key, masked client secret; stored encrypted via the
  core SiteSettings `SecretCipher` — the same cipher file/label as this
  module's `AccessTokenEncryptorHelper` and the github-sync cipher;
  rotating the cipher password forces re-entry for both integrations).

### Known upstream shape (for the planned zotero-picker)

- `app/src/ZoteroApiClient.mjs` — authenticated Zotero API client
  (works, collections, item metadata incl. BibTeX export via
  `?format=bibtex`).
- `app/src/ZoteroController.mjs` — `groups`, `getConnectionStatus`,
  `oauth`, `oauthCallback`, `unlink`.
- `app/src/TokenManager.mjs` — token persistence (encrypted).
- A "Zotero picker" UI (ORCID-picker-shaped: select works from a
  linked Zotero account and import them as `.bib` entries) is planned
  on top of this API surface — see plan `BIB_ORCID_TEMPLATES_PLAN.md`
  (P4).
