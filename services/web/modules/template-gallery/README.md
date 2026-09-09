# template-gallery

Upstream Overleaf CE module: the `/templates` page — a gallery of user
templates (by category), a per-template details/preview page, and create /
edit / delete template management (gated server-side by
`Settings.templates.user_id`, the "templates manager").

Local fork changes (see git log on the `bib-editor` branch):

## Theming + page chrome (CE+ parity with /project and /library)

- `app/src/TemplateGalleryController.mjs`
  - Both page routes now pass `userSettings` (the logged-in user's
    overallTheme) to the view, the same `themeLocals` pattern as
    `LibraryController` — `ol-userSettings` + `ol-overallThemes` meta tags
    are emitted by the pug views.
- `app/views/template_gallery/template-gallery.pug`, `template.pug`
  - Emit the theme meta; the details page no longer suppresses the navbar.
- `frontend/js/features/template-gallery/components/template-gallery-root.tsx`,
  `frontend/js/features/template/components/template-root.tsx`
  - The pages now render the **same design-system chrome** as `/library`
    and `/project` (DefaultNavbar, left ds-nav page switcher
    Library / Projects / Templates with the switcher's shared lower section
    (account + theme toggle), footer, cookie banner) and call
    `useThemedPage()` so the page follows the user's Dark / Light / System
    setting.

## Security fix (deep audit)

- `TemplateGalleryManager.getTemplate(key, val)`: the `key` was
  user-controlled and interpolated into the Mongoose query
  (`findFirst({ [key]: val })`) — `?$where` allowed a server-side JS
  boolean oracle and an unknown key degraded to `findOne({})`. Only
  `_id` (ObjectId-validated) and `name` — the two lookups the product
  uses — are accepted now; anything else is a safe miss with a warning
  log.

## Fixes

- `template-details.tsx` "Use as template" flow: optional URL params
  (`compiler`, `mainFile`, `language`) are now omitted when empty —
  `URLSearchParams` stringifies `undefined` to the literal string
  `"undefined"`, which `TemplatesManager` would treat as a real value
  (a main file literally named "undefined").
- Lint hygiene pass (unused imports/props/state, `useLocation` instead of
  `window.location` writes, malformed prop type, `autoFocus` via the core explicit-disable pattern, intentional effect-dep comments).
- Theme awareness on `/templates` + template details:
  - the shared navbar dark theme now also applies to this module's roots —
    core `components/navbar.scss`'s `@include theme('default')` scope lists
    `#template-root` / `#template-gallery-root` alongside
    `#project-list-root` / `#library-root` (previously the navbar fell
    back to the light mixin on these pages);
  - the page shell already ships `ol-userSettings` / `ol-overallThemes`
    metadata (controller `ThemeMixin` + pug meta tags) so `useThemedPage`
    drives `body[data-theme]`.
- Core `pages/templates-v2.scss`: gallery text inks were hard-coded to the
  light palette (`--neutral-90/70`) — now
  `--content-primary-themed` / `--content-secondary-themed` (title, h1/h2,
  sort buttons, no-results heading, caption title/description, author).

## Verification

- `eslint` clean (services/web, `--max-warnings 0`)
- Live: `/templates` renders + follows the user theme; switcher shows
  Library / Projects / Templates with Templates active; template details
  page same chrome; `getTemplate` probes pass
  (`$where` / unknown key / bad `_id` → no data; `key=name` still works).

## Admin-managed on/off + categories (SiteSettings, 2026-08-28)

The gallery is no longer boot-gated on `OVERLEAF_TEMPLATE_GALLERY`:

- `index.mjs` registers the router unconditionally; the env var survives
  only as the **seed** for the admin-stored value.
- `app/src/TemplateGallerySection.mjs`
  - `templateSection()` — per-request read of the `templates` section of
    the core `SiteSettings` feature (5 s TTL cache; **stored value wins
    over env**; env vars `OVERLEAF_TEMPLATE_GALLERY`,
    `OVERLEAF_TEMPLATE_CATEGORIES`, `TEMPLATE_<KEY>_NAME/DESCRIPTION`
    apply only while the admin has not stored a value).
  - `ensureGalleryEnabled` — applied to every gallery route in
    `TemplateGalleryRouter`: gallery OFF → plain 404 (hidden, not
    forbidden).
- `TemplateGalleryManager.getTemplatesPageData` — category list comes
  from the per-request section (stored wins), falling back to
  `Settings.templateLinks` (env seed) on read errors.
- `getSection().enabled === false` for a single category hides only
  that category's page (its templates remain stored).
- Manage UI: **Admin → Manage (submenu) → Manage Site** → Templates tab
  (gallery on/off switch + per-category on/off, name, description and
  live `Template` counts) — see `modules/admin-tools/README.md`.
