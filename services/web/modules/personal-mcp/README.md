# personal-mcp

Read-only personal MCP (Model Context Protocol) server for this Overleaf CE
fork. Each Overleaf user (LDAP or local) issues their own bearer tokens and
connects local MCP clients to the projects **their own Overleaf account can
read**. There are no write, delete, upload or compile tools.

## Enable

Environment variable for the `sharelatex` service:

```
PERSONAL_MCP_ENABLED=true
```

The module is registered in `moduleImportSequence` (`settings.defaults.js`)
but stays completely inert unless that variable is `true`.

## Token management (Account settings / web session + CSRF)

- `GET    /personal-mcp/tokens` — list own tokens (id, prefix, purpose, created/expires/lastUsed)
- `POST   /personal-mcp/tokens` — create `{ "purpose": "..." }`; the raw `olm_...` token is
  shown **once** in the 201 response, only its sha256 hash is stored
- `DELETE /personal-mcp/tokens/:token_id` — revoke (404 for someone else's id)

Max 10 tokens per user. A security alert email is sent on creation.

## MCP endpoint

`POST /mcp` (public API router) with `Authorization: Bearer olm_...`

From a workstation, reach the lab server via an SSH port-forward:

```
ssh -N -L 18443:127.0.0.1:8080 sawa@10.14.6.42
# MCP client url: http://127.0.0.1:18443/mcp
```

JSON-RPC methods: `initialize`, `ping`, `tools/list`, `tools/call`,
notifications. Tools:

| tool | args | result |
| --- | --- | --- |
| `list_projects` | — | projects the token owner can read (`id`, `name`, `role`) |
| `list_docs` | `project_id` | docs of the project (`id`, `path`) |
| `read_doc` | `project_id`, `doc_id` | `{ text, version }` — doc must belong to the project |

## Security model

- The userId is derived **only** from the bearer token (sha256 lookup +
  expiry + owner `users` lookup with `suspended` recheck on every request),
  never from the request body.
- Every read goes through the normal Overleaf checks
  (`AuthorizationManager.canUserReadProject`, `ProjectLocator.findElement`),
  enforced inside the Overleaf web process.
- Tokens are stored in `db.oauthAccessTokens` with a distinct scope
  (`personal_mcp_read`) and prefix (`olm_`), coexisting with git-bridge
  `olp_`/`git_bridge` PATs; neither type can authenticate the other.
- Expired tokens stop working immediately and are removed by the existing
  TTL index on `expiresAt`.
- Tokens are never logged and request bodies never reach the logger; only
  ids, tool names and status counters are recorded.
- LDAP note: disabling an account on the LDAP side does **not** revoke
  tokens (Overleaf never learns about it). The effective controls are the
  90-day expiry, per-request `suspended` recheck, and admin suspension
  (`/users` panel → suspend, which this module honors immediately).
