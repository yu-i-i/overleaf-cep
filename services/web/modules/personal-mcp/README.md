# personal-mcp

Personal MCP (Model Context Protocol) server for this Overleaf CE fork, with
**read** and opt-in **read + write** tokens. Each Overleaf user (LDAP or
local) issues their own bearer tokens and connects local MCP clients to the
projects **their own Overleaf account can access**. There is no compile tool;
compilation stays in the web UI.

## Enable

Environment variable for the `sharelatex` service:

```
PERSONAL_MCP_ENABLED=true
```

The module is registered in `moduleImportSequence` (`settings.defaults.js`)
but stays completely inert unless that variable is `true`.

## Token management (Account settings / web session + CSRF)

- `GET    /personal-mcp/tokens` — list own tokens (id, prefix, purpose,
  scope, created/expires/lastUsed)
- `POST   /personal-mcp/tokens` — create `{ "purpose": "...", "scope": "read" | "read_write" }`
  (stored scope values `personal_mcp_read` / `personal_mcp_read_write` are
  accepted too; anything else is rejected with 400). The raw `olm_...` token
  is shown **once** in the 201 response, only its sha256 hash is stored.
- `DELETE /personal-mcp/tokens/:token_id` — revoke (404 for someone else's id)

The account-settings widget has a permission dropdown (Read only /
Read + write) and shows each token's scope. Max 10 tokens per user. A
security alert email is sent on creation and states the granted scope.

## MCP endpoint

`POST /mcp` (public API router) with `Authorization: Bearer olm_...`

From a workstation, reach the lab server via an SSH port-forward:

```
ssh -N -L 18443:127.0.0.1:8080 sawa@10.14.6.42
# MCP client url: http://127.0.0.1:18443/mcp
```

JSON-RPC methods: `initialize`, `ping`, `tools/list`, `tools/call`,
notifications. **`tools/list` output depends on the token's scope**: a
read token sees only the three read tools; a read-write token sees all nine.
Calling a write tool with a read token fails as a tool error
(`SCOPE_DENIED`) before any service is touched.

### Read tools (all tokens)

| tool            | args                   | result                                                   |
| --------------- | ---------------------- | -------------------------------------------------------- |
| `list_projects` | —                      | projects the token owner can read (`id`, `name`, `role`) |
| `list_docs`     | `project_id`           | docs of the project (`id`, `path`)                       |
| `read_doc`      | `project_id`, `doc_id` | `{ text, version }` — doc must belong to the project     |

### Write tools (read-write tokens only)

| tool             | args                                   | result / notes                                                                                                        |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `create_project` | `name`                                 | `{ id, name }` — blank project via the web `createBlankProject` path (a root `main.tex` is created)                   |
| `create_doc`     | `project_id`, `path`, `content?`       | `{ id, path }` — parent folders are created (mkdirp); `CONFLICT` if the path is taken                                 |
| `update_doc`     | `project_id`, `doc_id`, `content`      | `{ version }` — **full replace**, applied through doc-updater so open editors update live                             |
| `delete_doc`     | `project_id`, `doc_id`                 | `{ id, deleted }` — docs only, never folders/files                                                                    |
| `move_doc`       | `project_id`, `doc_id`, `new_path`     | `{ id, path }` — move (and rename if the file name changes); `CONFLICT` if the destination is taken by another entity |
| `upload_file`    | `project_id`, `path`, `content_base64` | `{ id, path }` — ≤20 MB decoded; goes through the web file-import path (text-like names become docs)                  |

All write arguments are validated with strict JSON Schema (unknown
properties are rejected) and project-relative paths are checked for
traversal (`..`, empty/`.` segments, backslashes, control characters) before
any lookup.

## Security model

- The userId **and the scope** are derived **only** from the bearer token
  (sha256 lookup + expiry + owner `users` lookup with `suspended` recheck on
  every request). `user_id` or `scope` fields inside the JSON-RPC body are
  ignored.
- Double authorization for writes: the dispatcher refuses write tools for
  non-`personal_mcp_read_write` scopes, and the write service independently
  re-checks `AuthorizationManager.canUserWriteProjectContent` with a `null`
  link token **immediately before every mutation** — so read-only members and
  link-token-only members can never write even through a bug in layer 1.
  Link-token projects are invisible to the read tools as before.
- Tokens are stored in `db.oauthAccessTokens` with distinct scopes
  (`personal_mcp_read` / `personal_mcp_read_write`) and the `olm_` prefix,
  coexisting with git-bridge `olp_`/`git_bridge` PATs; neither type can
  authenticate the other.
- Expired tokens stop working immediately (90-day TTL) and are removed by
  the existing TTL index on `expiresAt`.
- Every write is audited as `{ userId, tool, projectId, docId/path }` — ids
  only, never content. Tokens and request bodies never reach the logger.

### Implementation notes / deviations from the original spec

- `update_doc` applies content via `DocumentUpdaterHandler.setDocument`
  (doc-updater HTTP), which bumps the revision and notifies live editors —
  the only safe full-replace channel in this CE architecture.
- The spec's serverless-era `DocstoreManager.createDocFromContent` /
  `updateStructure` do not exist in this fork; `move_doc` is a
  `moveEntity`(+`renameEntity` if the name changes) composition with a
  destination pre-check, matching the web file-tree behaviour.
- `upload_file` reuses `FileSystemImportManager.addEntity` via a temp file
  with `originalCp` semantics, identical to the web upload.
- LDAP note: disabling an account on the LDAP side does **not** revoke
  tokens (Overleaf never learns about it). The effective controls are the
  90-day expiry, per-request `suspended` recheck, and admin suspension
  (`/users` panel → suspend, which this module honors immediately).
