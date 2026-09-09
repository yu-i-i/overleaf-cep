# Dropbox Integration Module

This module provides an opt-in Dropbox integration for Overleaf Community Edition.

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DROPBOX_ENABLED` | Enable/disable the Dropbox module | `true` or `false` (default: `false`) |
| `DROPBOXINTERFACE_API_URL` | URL of the dropboxinterface microservice | `http://localhost:4003` |
| `DROPBOX_APP_KEY` | Dropbox OAuth app key | `your-app-key` |
| `DROPBOX_APP_SECRET` | Dropbox OAuth app secret | `your-app-secret` |

The OAuth redirect URI configured in the Dropbox app must be:

```
https://your-overleaf-host/user/dropbox/oauth/callback
```

## Setup

### 1. Enable the Module

Add to your `.env` file:
```bash
DROPBOX_ENABLED=true
```

### 2. Start the Dropbox Interface Microservice

The module requires `services/dropboxinterface` to be running:

```bash
cd /root/junk_webdav/overleaf-cep/services/dropboxinterface
npm start
```

Or use the autostart script:
```bash
/root/junk_webdav/overleaf-cep/server-ce/runit/dropboxinterface-overleaf/run
```

### 3. Configure Dropbox OAuth

1. Create a Dropbox app at [https://www.dropbox.com/developers/apps](https://www.dropbox.com/developers/apps).
2. Set `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` in the Overleaf environment.
3. Add `https://your-overleaf-host/user/dropbox/oauth/callback` to the Dropbox app's redirect URIs.
4. Users can connect their Dropbox accounts from the settings widget. The server performs the OAuth code exchange and stores the access token **and the refresh token** encrypted; users do not paste an access token.

> **Token lifetime:** Dropbox OAuth2 access tokens expire after a few hours. On connect the server requests `token_access_type=offline` so it also receives a refresh token, which it stores (encrypted). When a request is rejected as expired, the server transparently rotates the pair via `api.dropboxapi.com/oauth2/token`, persists both new tokens, and retries — so a linked connection keeps working across token expiries without user action. (Connections made before this behaviour only stored the access token and must be re-connected once to gain a refresh token.)

## API Endpoints

### User Connection Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/user/dropbox/oauth2` | Start the Dropbox OAuth flow |
| `GET` | `/user/dropbox/oauth/callback` | Complete OAuth and store the encrypted token |
| `GET` | `/user/dropbox/status` | Get connection status for current user |
| `POST` | `/user/dropbox/connect` | Legacy direct-token connection endpoint |
| `POST` | `/user/dropbox/disconnect` | Disconnect from Dropbox |

### Project Synchronization

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/project/:project_id/dropbox/state` | Get sync state for a project |
| `POST` | `/project/:project_id/dropbox/link` | Link project to user's Dropbox |
| `DELETE` | `/project/:project_id/dropbox/state` | Unlink project from Dropbox |
| `POST` | `/project/:project_id/dropbox/pull` | Pull remote changes into Overleaf |
| `POST` | `/project/:project_id/dropbox/push` | Push local changes to Dropbox |
| `GET` | `/project/:project_id/dropbox/files` | List files in project's Dropbox folder |
| `POST` | `/project/new/dropbox` | Create an Overleaf project from a remote Dropbox folder |

## Sync Behavior

### Manual Sync Operations

- Click "Pull" (Import) to mirror the Dropbox folder into the project: the Dropbox folder becomes the project content; files that exist only locally are deleted
- Click "Push" (Export) to mirror the project to Dropbox: the project becomes the Dropbox folder; files that exist only on Dropbox are deleted
- Deletions happen only after a full remote listing succeeds; a missing remote project folder aborts the import without touching local content
- Sync-excluded entries (hidden files, LaTeX transients) are never created, applied or deleted on either side
- New-project import downloads the selected remote folder through the TPDS import pipeline

**Note**: The module uses manual triggers instead of automatic polling. Files are only synchronized when you explicitly click Pull or Push.

## File Sync Strategy

1. **Revision snapshots** store Dropbox's `rev` per remote file together with a `localHash` baseline (sha256 of the content as last synchronized)
2. **Change detection (export/Push)** — incremental since 2026-08-19: a file is skipped when its remote `rev` is unchanged since the last sync AND the local content hash matches the stored baseline; any miss (no baseline, rev changed, content changed) uploads as before (local still wins). The push response reports `uploadedFiles` and `skippedFiles`
3. **Change detection (import/Pull)** skips downloading/applying a remote file only when its rev is unchanged, the local content is unchanged, and the local entity still exists; changed remote, locally-deleted and missing baselines all apply (remote wins)
4. **Mirror deletion** removes the one-sided entries after each operation: local-only on import, remote-only on export; excluded entries are never touched
5. **No per-file conflict state** is generated; every completed mirror run clears legacy conflict entries

Note: Dropbox's list metadata `hash`/`content_hash` fields are passed through and stored, but are deliberately NOT used for change detection — the live API's `content_hash` is not a plain SHA-256 of the byte content (verified in production: identical bytes, different values), so decisions rely on `rev` + the locally computed content-hash baselines, which is fully under our control.

## Frontend Components

- `dropbox-widget.tsx` - User settings widget
- `dropbox-integration-card.tsx` - Project integrations panel card
- `dropbox-sync-modal.tsx` - Sync operations modal with pull/push buttons

## Encryption

OAuth access tokens are stored encrypted in the database using AES-256-GCM encryption.

**Important**: The module uses `DROPBOXINTERFACE_API_URL` to connect to the dropboxinterface microservice. Dropbox OAuth tokens are encrypted by the web module using the shared `WEBDAV_TOKEN_CIPHER_PASSWORD` key; the microservice receives the token only for API operations.

## Usage Example

### Connect a User to Dropbox

```javascript
// Start OAuth in a browser while authenticated
open https://your-overleaf-host/user/dropbox/oauth2
```

### Pull Remote Changes

```javascript
curl -X POST http://localhost:3000/project/12345/dropbox/pull \
  -H "Cookie: overleaf_session_id=..."
```

### Check Connection Status

```javascript
curl http://localhost:3000/user/dropbox/status
// Response: {"connected": true, "path": "...")
```

## Differences from WebDAV Module

| Aspect | WebDAV | Dropbox |
|--------|--------|---------|
| **Auth** | Basic Auth (username/password) | OAuth 2.0 access token |
| **Versioning** | ETags (`getetag`) | Revision strings (`rev`) |
| **SDK** | `webdav` npm package | `dropbox` npm package |
| **API Style** | HTTP methods + WebDAV verbs | Pure RESTful JSON API |

## References

- [Dropbox Interface Microservice](../../../dropboxinterface/)
- [Dropbox SDK Documentation](https://dropbox.github.io/dropbox-sdk-js/)
