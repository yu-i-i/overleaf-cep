# track-changes

Upstream Overleaf CE module: per-project "Track changes" — comments on the
source document that collaborators can enable/disable per project (and
optionally for guests), threaded messages, and "accept changes" which
applies the tracked edits.

Local fork changes (deep-audit round, `bib-editor` branch):

## Security / permission hardening (`TrackChangesController.mjs`, `TrackChangesRouter.mjs`)

- **State validation** — `POST …/track_changes` used to persist `req.body`
  verbatim into the project document (operator-style bodies like
  `{"$ne": 1}` went straight in). The state is now validated before
  writing: `on` must be a boolean, `on_for` a plain object whose keys are
  user ids (or `__guests__`) with boolean values, `on_for_guests` a
  boolean; invalid bodies get a proper **400** (CE's generic error
  pipeline does not map `OError` info-status codes to 4xx — the handler
  responds directly).
- **Authorisation** — `accept-changes` and `delete-thread` now require
  project **content-write** permission (`ensureUserCanWriteProjectContent`)
  instead of read.
- **Message ownership** — edit / delete of a thread message verify the
  caller is the message author via `ChatApiHandler.getThreadMessage` and
  CE's `NotFoundError` / `ForbiddenError` classes (404 / 403; plain
  `OError` status in info would fall through to 500 in the CE pipeline).
- **Event ordering** — `accept-changes` applies the change **before**
  announcing to the room, so a failure no longer desynchronises clients.
- **Rate limits** — per-route limiters (`track-changes-reads` 60/min,
  `track-changes-writes` 20/min) registered in the router.

## Verification

- `eslint` clean; live probe battery P1–P7 (valid toggle → 204,
  `on:"x"` → 400, malformed `on_for` → 400, valid map → 204 + correct
  stored shape `{"__guests__": false}` / user-id map, guest toggle → 204,
  non-boolean flag → 400, operator body → 400).

## Notes

- `resolve-thread` / `reopen-thread` intentionally remain read-level
  (soft state; upstream parity).
- Upstream ships no unit tests for this module; the probe battery is the
  regression guard.
