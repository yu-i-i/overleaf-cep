# SSO Test Environment — How to Test OIDC / SAML / LDAP Login

**Scope**: the multi-provider SSO feature of this Overleaf build
(login strategies from stock Overleaf CE + the stored-config engine,
admin UI and boot hydration added by this project).

**Important separation**

| Part | Where it lives |
|------|----------------|
| SSO **code** (login strategies, admin console, hydrator) | this repository — production-ready |
| **Identity Provider test servers** (`ldap`, `oidc`, `saml`) | **NOT in git** — external docker containers on the dev host, shared between developers for end-to-end testing |

Anyone with access to the dev host can run the tests below against the
same IdP containers; no code changes or rebuilds are needed to switch
between the test IdPs and a production IdP (all SSO config is stored in
the *Manage Site* console, not in compose/files).

Deployed instance: `https://psintern.neuro.uni-bremen.de`
(test admin: `testjoe@rotermund.at`)

---

## 1. The three test IdP containers

| Container | Image | URL | Test account(s) |
|-----------|-------|-----|-----------------|
| `saml` | `saml-saml:latest` | `http://saml:8081` (host: `127.0.0.1:8081`) | `test@example.com` / `password` · `admin@example.com` / `admin` · `overleaf.admin@example.com` / `admin` |
| `oidc` | `oidc-oidc:latest` | `http://oidc:8080` | `test2@example.com` / `password` |
| `ldap` | `osixia/openldap:1.5.0` | `ldap://ldap:389` | `carol.jones@example.com` / `carolpass` (dn `uid=cjones,ou=people,dc=example,dc=com`) |

All three sit on the `overleaf-network` docker network; `/etc/hosts` on
the host maps `saml`, `oidc`, `ldap` → `127.0.0.1`. The Overleaf
container reaches them by container name (`saml:8081`, `oidc:8080`,
`ldap:389`).

Quick health check from the host:

```sh
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'saml|oidc|ldap'
# all three: "Up … (healthy)"

# SAML IdP login page
curl -s http://127.0.0.1:8081/saml/idp/SSOProbe -o /dev/null -w '%{http_code}\n' || true
# OIDC issuer
curl -s http://127.0.0.1:8080/sso/realms/master/.well-known/openid-configuration | head -3
# LDAP bind probe (as the service bind account)
ldapsearch -x -H ldap://127.0.0.1:389 -b dc=example,dc=com "(mail=test@example.com)" dn 2>&1 | head
```

## 2. Pointing Overleaf at the test IdPs

Log in as admin → **Manage Site** (your account menu → *Manage
Extensions* → the SSO tabs) and set the stored values. **Nothing in
compose** — the boot hydrator writes them to every service at container
start, and stored values win over any environment defaults.

### SSO SAML tab  (`PUT /admin/site-settings/sso-saml`)

| Field | Test value |
|-------|-----------|
| Display name | `Log in with Test SAML` |
| Enable | on |
| SP Issuer / Entity ID | `MyOverleaf` |
| IdP single sign-on service (EntryPoint) | `http://saml:8081/saml/idp/SSOService` |
| Audience | `MyOverleaf` |
| IdP certificate (PEM) | the IdP's X.509 cert (already stored — leave the secret field empty to keep it) |
| Require signed assertions | on |
| SP Private Key | optional (leave empty) |

SP metadata for the IdP side: `GET /saml/metadata` (link in the tab).

### SSO OIDC tab  (`PUT /admin/site-settings/sso-oidc`)

| Field | Test value |
|-------|-----------|
| Display name | `Log in with Test OIDC` |
| Issuer | `http://oidc:8080/sso/realms/master` |
| authorization / token / userInfo URLs | issuer + `/protocol/openid-connect/{auth,token,userinfo}` |
| logout URL | issuer + `/protocol/openid-connect/logout` |
| clientID | `overleaf_test` |
| clientSecret | *(stored encrypted — leave empty to keep)* |
| scope | `openid profile email` |

Required redirect URI registered on the IdP:
`https://psintern.neuro.uni-bremen.de/oidc/login/callback`

**Production (current stored config)**: issuer
`https://sso.fb1.uni-bremen.de/sso/realms/master`, display name
"Log in with SSO FB1 Uni Bremen", same clientID — i.e. the *live* system
currently points at the real FB1 IdP; use the values above to switch to
the test IdP, and vice versa, entirely from this tab.

### SSO LDAP tab  (`PUT /admin/site-settings/sso-ldap`)

| Field | Test value |
|-------|-----------|
| Display name | `Log in with Test LDAP` |
| LDAP url | `ldap://ldap:389` |
| searchBase | `dc=example,dc=com` |
| bindDN | `cn=admin,dc=example,dc=com` |
| bindCredentials | *(stored encrypted)* |
| searchFilter | `(mail={{username}})` |
| searchScope | `sub` |
| Email attribute | `mail` |
| Update user details on login | on |

## 3. End-to-end test procedure

1. **Login page** — as an anonymous user, `/login` must show:
   - the two/three "Log in with …" SSO buttons (one per enabled
     provider, in stored display-name order),
   - the LDAP hint line ("Organizational (LDAP) accounts also sign in
     through this login form …") when LDAP is enabled — LDAP users use
     the **main** email/password form (bind against the directory).
2. **SAML round trip**: click "Log in with Test SAML" → you are
   redirected to `http://saml:8081/saml/idp/SSOService?SAMLRequest=…` →
   enter `test@example.com` / `password` → land back on the app at
   `/project` **already logged in**.
3. **OIDC round trip**: click the OIDC button → `oidc:8080` login page →
   `test2@example.com` / `password` (+ consent if shown) → back at
   `/project` logged in, via `/oidc/login/callback`.
4. **LDAP login**: on `/login` use `carol.jones@example.com` /
   `carolpass` in the standard form → `/project` logged in.
5. **Single logout**: while an SSO session is active, click *Log Out*
   in the account menu → the app session is destroyed **and** the IdP
   SLO endpoint is invoked (SAML: `/saml/logout/callback`; OIDC: the
   stored logout URL).
6. **New users**: each SSO login auto-creates its account (email
   confirmation disabled in this build).

Expected negative behavior (to confirm it fails *closed*):
- wrong IdP password → bounced back to `/login` with an error, no
  session;
- provider disabled in the console → its button disappears from
  `/login` on the next page load (no restart needed).

### Scripted regression (used for verification on this host)

A CDP (Chrome DevTools Protocol) driver lives in-repo:
`services/web/modules/bib-editor/test/e2e/cdp.mjs` — it launches a
headless `chromium-browser` with an isolated profile and exposes
`newTab` / `evalIn` / `attach`. All SSO E2E checks in this session were
run through it (login → IdP form fill → submit → assert `/project`).

## 4. Switching back to production

All in **Manage Site** (no rebuild):

- **OIDC**: restore the FB1 values (issuer
  `https://sso.fb1.uni-bremen.de/sso/realms/master`, display name
  "Log in with SSO FB1 Uni Bremen"); keep the stored clientSecret
  (leave the field blank when saving).
- **SAML / LDAP**: enter the real IdP's EntryPoint / certificate / url /
  DN — the stored values you have today in the SAML and LDAP tabs are
  the test ones; the engine treats every field identically for test and
  production.

The stored configuration (secrets encrypted at rest as
`ss::OL_CEP-…` strings in the `site_settings` Mongo document
`_id: "global"`) survives docker restarts; `compose` only carries the
fixed `SERVER_PRO: true` for this stack.

## 5. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Button missing on `/login` | provider `enabled: false` in the stored section — enable it in the tab |
| Redirect loop / 302 back to `/login` | wrong EntryPoint/token URL, or the IdP's registered **redirect URI** doesn't match `…/oidc/login/callback` / `…/saml/login/callback` |
| SAML "Not your identity provider" | IdP doesn't know the SP (metadata URL not registered: `/saml/metadata`), or entity IDs differ (SP issuer `MyOverleaf`) |
| SAML signature error | IdP certificate in the console is stale — re-paste from the IdP |
| OIDC `invalid_client` | clientSecret blanked by an explicit empty save (an *empty* save keeps the stored secret; clearing it is only done server-side on explicit reset) or clientID renamed on the IdP side |
| LDAP "invalid credentials" | wrong bindDN/bindCredentials, or `searchFilter` doesn't match the directory (the test accounts above are the reference) |
| Works in browser, fails from server container | container can't resolve the IdP hostname — must be on `overleaf-network` or reachable via the same DNS |

Server-side log:

```sh
docker logs overleafserver --since 30m | grep -iE 'saml|oidc|ldap|passport'
```
