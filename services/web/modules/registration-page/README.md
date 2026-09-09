# registration-page

Fork module (CE+): the `/register` self-service sign-up page + handler
(domain-allowlist support, `UserRegistrationHandler`).

## Fork change (2026-08-28): per-request enablement

The page is no longer boot-gated on
`OVERLEAF_ENABLE_REGISTRATION_PAGE` / SSO presence:

- `index.mjs` registers the router unconditionally; the legacy default
  (on unless `ldap`/`saml`/`oidc` auth is configured) survives as the
  SiteSettings **seed**.
- `app/src/RegistrationSection.mjs`
  - `signupSection()` — per-request read of the `signup` SiteSettings
    section (stored value wins over env; 5 s TTL cache).
  - `ensureRegistrationEnabled` — applied to `GET /register` (OFF →
    404, hidden) and `POST /register` (OFF → 403). Fails **open** on
    read errors (an Outage in Mongo must not lock out the only way in
    on non-SSO sites).
- Manage UI: **Account → Manage → Manage Site → Sign Up tab**
  (on/off switch + allowed email domains, comma-separated, `*.`
  wildcard syntax supported by `RegistrationPageController`).
