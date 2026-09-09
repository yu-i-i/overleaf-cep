# SiteSettings (core feature)

Admin-managed, per-site settings backed by MongoDB
(`site_settings` collection, single document `_id: 'global'`).
Introduced 2026-08-28 to de-bootgate the admin-facing switches
(template gallery, Zotero connector, external URL linked files, sign-up
page) so they can be toggled at runtime from the
**Manage Extensions** admin page (`/admin/site`, chrome identical to `/admin/user`).

## Design (see `BIB_ORCID_TEMPLATES_PLAN.md`, decision 3.0)

- **Stored value wins over environment**; env vars are **seeds** that
  apply only while the admin has not stored a value for that field.
  This keeps existing deployments working unchanged on first run.
- **Per-request reads** (the web app runs 2 workers — no
  process-local truth), served through a 5 s TTL in-memory cache +
  in-flight dedupe: admin saves become visible across workers within
  ~5 s without hammering MongoDB.
- **Secrets** (currently `zotero.clientSecret`) are stored encrypted
  (`SecretCipher.mjs` — `@overleaf/access-token-encryptor`,
  `encryptJson`/`decryptToJson`; the same cipher **file and label**
  `OL_CEP-v3` as the zotero + github-sync token ciphers), never
  returned in GET responses (masked + `...Set` flag), and an empty
  secret in a PUT payload means "keep the stored value".
- Fail-soft: read errors degrade to env seeds (warn-logged);
  `setSection` throws when the DB is unavailable.

## Files

- `SiteSettingsManager.mjs`
  - `getSection(name, coreSettings)` — stored ∪ env-seeds per section
    (`templates`, `zotero`, `externalUrl`, `signup`)
  - `setSection(name, value)` — upsert under the per-section key
  - `maskSecrets`, `invalidateCache`, `DEFAULT_TEMPLATE_CATEGORIES`
    (the 12 manual example categories), per-section validators
    (`SECTION_VALIDATORS`: templates shape/keys, zotero clientKey
    charset, externalUrl CIDR + regex validity, signup domain syntax)
- `SecretCipher.mjs` — `encryptText` / `decryptText` (`ss::` prefix on
  our values; transparently decrypts bare zotero/github-sync values)

## Consumers

- `app/src/infrastructure/ExpressLocals.mjs` — `res.locals.templates`
  (per-request category list + `templatesEnabled`) for page data.
- `modules/template-gallery` — `TemplateGallerySection.mjs`
  (enablement + categories), `TemplateGalleryManager.getTemplatesPageData`.
- `modules/zotero` — `ZoteroSection.mjs` (enablement for link flow +
  create-file gate in core `LinkedFilesController`).
- `modules/registration-page` — `RegistrationSection.mjs`
  (enablement for `/register`).
- `modules/admin-tools` — `SiteSettingsController.mjs`
  (`/admin/site`, `/admin/site-settings`) — the only writer.

## Raw collection

`site_settings` is registered in
`app/src/infrastructure/mongodb.mjs` (`db.siteSettings`); the manager
imports it **lazily** so test environments without Mongo settings can
import the module safely.

## Tests

`services/web/test/unit/src/site-settings.test.mjs` — validators
(valid + invalid per section), `DEFAULT_TEMPLATE_CATEGORIES` (12 keys,
named+described), `maskSecrets`, env-seed behavior for all four
sections, and the cipher round-trip.
