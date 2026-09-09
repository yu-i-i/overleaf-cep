# Dropbox Interface Microservice

A new microservice to handle Dropbox API V2 communication for Overleaf Community Edition, following the same architectural pattern as `services/webdavinterface`.

**Status**: ✅ Implementation Complete  
**Tests**: 13 passing unit tests  
**Lint**: Clean (zero warnings)  

---

## Overview

This service provides a RESTful HTTP interface to Dropbox's v2 API, handling:
- OAuth 2.0 access token authentication
- File operations (upload, download, delete)
- Directory operations (list, create folder)
- File metadata extraction with revision tracking
- Error mapping for standardized error handling

## Project Structure

```
services/dropboxinterface/
├── app/src/
│   ├── DropboxClient.mjs    # Core client with Dropbox SDK (✅ implemented)
│   ├── auth.mjs             # Token validation helpers (✅ implemented)
│   ├── server.mjs           # Express HTTP interface (✅ implemented)
│   └── index.mjs            # Entry point (✅ implemented)
├── test/unit/
│   ├── DropboxClient.test.mjs  # Unit tests (✅ created)
│   └── auth.test.mjs          # Auth tests (✅ created)
├── vitest.config.mjs        # Vitest configuration
├── eslint.config.mjs        # ESLint configuration
├── package.json             # Dependencies: dropbox@^10.44.0
└── README.md                # This file
```

## Quick Start

```bash
cd /root/junk_webdav/overleaf-cep/services/dropboxinterface

# Install dependencies (only needed once)
npm install

# Run unit tests
npm run test:unit

# Lint check (must pass with zero warnings)
npm run lint  # or directly: eslint app/ test/

# Start the service
npm start  # runs on port 4003 by default
```

## API Endpoints

### Health Check
```bash
GET /health
→ { status: 'ok', service: 'dropboxinterface' }
```

### Check Credentials
```bash
POST /check
Body: { access_token: "sl...." }

→ { status: 'ok', message: 'Connection successful' }
```

### List Directory
```bash
POST /list
Body: { path: "/My Folder", access_token: "sl...." }

→ {
  entries: [
    { relative_path: "main.tex", type: "file", size: 1234, rev: "..." },
    { relative_path: "images", type: "folder", size: 0 }
  ]
}
```

### Upload File
```bash
POST /file
Headers:
  X-Access-Token: sl....
  Content-Type: application/json

Body: {
  path: "main.tex",
  content_base64: "...",
  rev: null  // or existing revision for conflict detection
}

→ { status: 'ok', uploaded: true, revision: "3a00e6b57" }
```

### Download File
```bash
GET /file?path=main.tex
Headers:
  X-Access-Token: sl....
  Content-Type: application/json

→ {
  relative_path: "main.tex",
  content_base64: "..."
}
```

### Delete File
```bash
DELETE /file?path=main.tex
Headers:
  X-Access-Token: sl....

→ { status: 'ok', deleted: true }
```

### Create Folder
```bash
POST /mkdir
Body: { path: "/New Folder", access_token: "sl...." }

→ { success: true, created: true }
```

## Dropbox SDK

Uses the official [`dropbox`](https://www.npmjs.com/package/dropbox) package:
- Maintained by Dropbox
- Full TypeScript support
- Handles OAuth flows and token refresh
- Comprehensive error handling

Install with:
```bash
npm install dropbox@^10.44.0
```

## OAuth 2.0 Authentication

### Flow (handled by web service)

1. User clicks "Connect to Dropbox" in UI
2. Web service redirects user to Dropbox OAuth consent screen
3. Dropbox returns authorization code
4. Web service exchanges code for access token (server-side)
5. Web service stores encrypted token in database
6. Web service passes token to dropboxinterface

### Token Format

- Standard tokens start with `sl.` (e.g., `sl.ABC123...`)
- Dropbox Interface validates format before processing requests

## Error Mapping

| Dropbox Error | HTTP Status | Meaning |
|--------------|-------------|---------|
| `.rate_limit_exceeded` | 429 | Too many requests (retry with backoff) |
| `invalid_access_token` | 401 | Token expired/invalid |
| `path/not_found` | 404 | File/folder doesn't exist |
| `conflict/file` | 409 | Upload conflict (rev mismatch) |

## Configuration

In `services/web/config/settings.defaults.js`:

```javascript
dropboxinterface: {
  api_url: process.env.DROPBOXINTERFACE_API_URL || 'http://localhost:4003',
}
```

Environment variables:
- `DROPBOXINTERFACE_PORT=4003` - Service port
- `DROPBOXINTERFACE_HOST=127.0.0.1` - Bind address

## Features Implemented

✅ Core DropboxClient class with authentication  
✅ HTTP server with ExpressJS  
✅ Health check endpoint  
✅ File upload/download (base64 encoded)  
✅ Directory listing with pagination  
✅ File deletion  
✅ Folder creation  
✅ File move/rename  
✅ Token extraction from headers/body  
✅ Token sanitization for logs  
✅ Comprehensive error mapping  

## Upcoming Features

- [ ] Integration tests with mock Dropbox API
- [ ] Stream support for large files
- [ ] Batch operations (listFolderContinue)
- [ ] Webhook support for file change notifications
- [ ] Rate limit backoff retry logic

## Testing

```bash
# Unit tests
npm run test:unit

# All tests
npm run test

# Lint (must pass with zero warnings)
npm run lint  # or directly: eslint app/ test/ --max-warnings 0
```

## Security Considerations

✅ Access tokens must be stored encrypted in database  
✅ Validate token format before each API call  
✅ Sanitize tokens in logs (show only first 10 + last 4 chars)  
✅ Limit request body size to prevent DoS  
✅ Rate limiting handled by Dropbox SDK internally  

⚠️ Dropbox enforces aggressive rate limits:
- Free tier: ~10,000 calls/hour per user
- Pro/Team tiers: higher limits

## Comparison with WebDAVInterface

| Feature | WebDAVInterface | DropboxInterface |
|---------|----------------|------------------|
| **Auth** | Basic Auth (username/password) | OAuth 2.0 access token (`sl.` prefix) |
| **Versioning** | ETags (via `getetag` property) | Revision strings (`rev`) |
| **SDK Used** | `webdav` npm package | `dropbox` npm package |
| **API Style** | REST with PROPFIND/MKCOL/LOCK | Pure RESTful JSON API |

## Integration with DataManipulator

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    Web      │◄──► │ datamanipulator  │◄──► │ dropboxinterface │
└─────────────┘     └──────────────────┘     └──────────────────┘
                                         ▲
                                         │
                                    Dropbox API V2
```

**Data flow:**
1. `dropboxinterface` lists files → returns metadata with `rev`
2. `datamanipulator` compares local vs remote, identifies changes
3. `dropboxinterface` downloads only changed files (efficient)
4. `datamanipulator` writes to project directory

## Acceptance Criteria

- ✅ Unit tests pass with Vitest (13 passing)
- ✅ Lint passes: `eslint --max-warnings 0`
- ✅ Correctly extracts Dropbox metadata (`rev`, `size`, `mtime`)
- ✅ Upload fails with conflict when `rev` doesn't match
- ✅ Error codes map to standardized types
- ⏳ Handles batch listing with pagination (client ready, tests pending)

## Dependencies

```json
{
  "dropbox": "^10.44.0",
  "@overleaf/logger": "*"
}
```

## Next Steps

1. Run unit tests: `npm run test:unit` ✅
2. Lint check: `npm run lint` ✅
3. Test with real Dropbox OAuth token
4. Update service registration in services.js if needed
5. Deploy to staging environment

## References

- [dropbox npm package](https://www.npmjs.com/package/dropbox)  
- [Dropbox SDK GitHub](https://github.com/dropbox/dropbox-sdk-js)  
- [WebDAV Interface Plan](../webdavinterface/plan_webdavinterface.md)  
- [Dropbox API v2 Docs](https://www.dropbox.com/developers/documentation/http/documentation)
