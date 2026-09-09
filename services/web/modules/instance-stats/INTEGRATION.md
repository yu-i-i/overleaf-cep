# Instance Statistics — Integration Notes (module-local)

> Package-level doc: `stats_feature/README.md` (the folder that contains
> this module). This file covers the module internals, the metric contract,
> and the integration gotchas that have been hit and fixed.

## 1. Module layout (as deployed in the web app)

```
services/web/modules/instance-stats/
├── index.mjs                       # WebModule { router } entry (auto-loaded)
├── app/src/
│   ├── InstanceStatsController.mjs # page + /api/series + alert-config API
│   ├── InstanceStatsRouter.mjs     # routes (site-admin only)
│   ├── collectInstanceStats.mjs    # hourly cron entry (server-ce/cron)
│   ├── instanceStatsConstants.mjs  # STAT_KEYS, SERIES_COUNTS, WINDOWS, toUtcMidnight
│   ├── alertChecker.mjs            # threshold evaluation + mail dispatch
│   ├── seedInstanceStats.mjs       # fake-history backfill for dev/demo
│   ├── verifyInstanceStats.mjs     # series-length sanity check
│   ├── clearInstanceStats.mjs      # destructive clear (env-guarded)
│   └── models/
│       └── InstanceStatAlertConfig.mjs  # module-local Mongoose model (string _id)
├── app/views/instance-stats.pug    # admin page (Plotly CDN, no npm dep)
├── frontend/js/pages/instance-stats.ts   # webpack entry (auto-discovered)
├── frontend/js/features/instance-stats/  # config.ts, render.ts, api.ts,
├                                         # settingsPanel.ts, types.ts
└── test/unit/src/*.test.mjs        # vitest unit tests (pure JS)
```

Note: the *data* model `InstanceStat` lives **outside** the module, at
`services/web/app/src/models/InstanceStat.mjs` (added by the external patch,
not part of this directory tree) — same namespace as the other shared app
models. Do **not** move it; the external patch is the only thing that
creates it and the module does not ship a copy.

## 2. Metric contract (values layout per statKey)

`InstanceStat` document: `{ statKey: String, day: Date (UTC midnight),
values: Number[], generatedAt: Date }`.

| statKey | values | notes |
|---|---|---|
| `active_projects` | `[n]` | `lastUpdated >= oneDayAgo` |
| `active_users` | `[n]` | `lastActive >= oneDayAgo` |
| `new_users` | `[n]` | **CE**: `signUpDate >= oneDayAgo` |
| `shared_projects` | `[n]` | **CE**: `tokens.readAndWrite` exists |
| `user_count` | `[n]` | |
| `project_count` | `[n]` | |
| `file_count` | `[n]` | counts `docs` (CE "files") |
| `mongodb_storage` | `[bytes]` | `db.stats().totalSize` |
| `overleaf_storage` | `[bytes]` | `du -b0s /var/lib/overleaf` |
| `redis_storage` | `[diskBytes, ramBytes]` | Redis AOF size + `used_memory` |
| `disk_usage` | `[availableBytes, totalBytes]` | `df -B1 /var/lib/overleaf` — used % = 100 − avail/total |
| `cpu_load` | `[load1]` | `/proc/loadavg` 1-min load (line chart) |
| `ram_usage` | `[freeBytes, usedBytes]` | `/proc/meminfo` |

`SERIES_COUNTS` in `instanceStatsConstants.mjs` is the single source of
truth the seeder and verifier iterate over. The frontend `config.ts`
keeps its own (frontend-only) mirror — the two cannot share a module
since webpack only bundles the `frontend/` tree.

## 3. Alert configuration (Mongo, not env)

The alert settings are stored on a *single* document in Mongoose, model
`InstanceStatAlertConfig`, collection `instanceStatAlertConfigs`, `_id`
fixed to the **string** `instance-stats` (default: 90 % on both disk and RAM,
blank `alertEmail` = disabled).

The schema declares `_id: { type: String, default: 'instance-stats' }`.
The default Mongoose `_id` is `ObjectId`, and the controller and
alert checker query/update it *by the string literal* `ALERT_CONFIG_ID =
'instance-stats'` — if the schema field were removed, mongoose 8 would
throw `CastError: string 'instance-stats' cannot be cast as ObjectId`.
This is the one non-obvious piece of the model; don't "clean up" away the
`_id` override.

## 4. Alert dispatch (do-not-break)

- `alertChecker.mjs` → `runThresholdChecks()`
  1. Reads the alert-config doc.
  2. Reads latest `disk_usage` + `ram_usage` points from `InstanceStat`.
  3. Calls `evaluateAlerts(diskUsage, ramUsage, config)` — pure, unit-tested.
  4. For each firing metric, calls
     `EmailSender.promises.sendEmail({to, subject, text, html}, 'instance_stats_alert')`.
  5. Only updates the `lastXAlertAt` stamps **after** the email promise
     resolves. A failed email leaves the stamp *not* updated, so the next
     cron run gets one more shot.
- Throttle: at most **one alert per metric per 24h** (per `lastDiskAlertAt`
  / `lastRamAlertAt`). The throttled check is inside `evaluateAlerts`, so
  the alert never fires more than once per 24h per metric even if the
  threshold stays breached.
- Called from `collectInstanceStats.mjs` after the day's upserts, inside
  a `try/catch` so a mail failure **never** breaks the cron run.

## 5. Runtime assumptions

- **Host metrics** are read from the *web* container:
  - `df -B1 /var/lib/overleaf` — disk
  - `/proc/loadavg` — CPU
  - `/proc/meminfo` — RAM
  In Docker these see the host because the Overleaf docker-compose mounts
  `/var/lib/overleaf` and the `/proc` is host-backed for these paths. In
  a bare-metal install this is just the filesystem. On macOS/local dev the
  collector logs a warning and writes `0,0` (the chart is blank, not broken).
- **No backfill**: the collector only writes the *current UTC day* bucket.
  Use `seedInstanceStats.mjs` (env `INSTANCE_STATS_SEED_DAYS=400`) to
  backfill fake history for dev/demo.
- **Retention**: days older than `INSTANCE_STATS_RETENTION_DAYS` (default
  365) are pruned by the collector on each run.
- **Env knobs** (set in `settings.defaults.js`):
  - `INSTANCE_STATS_ENABLED` (default `true`)
  - `INSTANCE_STATS_RETENTION_DAYS` (default `365`)
- **CSRF**: the alert-config PUT/POST go through
  `frontend/js/infrastructure/fetch-json`'s
  `putJSON/postJSON`, which read the `ol-csrfToken` meta tag
  (`app/views/layout-base.pug`) and set the `X-Csrf-Token` header — no
  extra wiring needed for a standard Overleaf app.

## 6. Bugs that were hit and fixed during development

1. **`new_users` field**: the first revision used
   `projects.countDocuments({ createdAt: { $gte: oneDayAgo } })` for a
   metric that never existed as a "new" metric in this fork. The CE `User`
   model has `signUpDate`, not `createdAt`. Replaced. If porting to SaaS
   where `User.createdAt` exists, prefer that for "new users in the last
   day".
2. **Disk-alert sign**: the first alert code computed
   `used = available / total`; the actual intent is
   `used = 1 − available/total`. Fixed to
   `Math.round(100 − (available/total)*100)`.
3. **`cpu_load` series count**: `/proc/loadavg` is a 4-column line
   `[load1, load5, load15, "n/n"]`. The feature spec asked for three
   load averages in one bar (1/5/15 min), but the `values: number[]` type
   is a single series per metric *in the DB* for a stable UI. The
   current implementation stores `values = [load1]` and renders it as a
   line. If a revision wants 5/15 min, add a new stat key, don't widen this
   one.
4. **Model `_id` CastError** (see §3).
5. **`toUtcMidnight` used 3 places** (collector, seeder, verifier,
   controller). Deduped into `instanceStatsConstants.mjs`.
   **Don't duplicate it back.**
6. **Redis `client` is `RedisWrapper.client('instance_stats')`** — a
   feature name that is not in any default `Settings.redis` config, so
   `client()` falls back to `Settings.redis.web`. If the target adds the
   feature to a proper `Settings.redis` entry, this is where it would go.

## 7. Verification

- `node --check` on all `.mjs` in `app/src/` (including `models/`).
- `services/web` → `yarn install` → `yarn test` (vitest picks up
  `modules/*/test/unit/**/*.test.mjs`).
- `services/web` → `yarn lint` (ESLint, `*.mjs` + `*.ts`).
- Manual: boot the instance as an admin, visit `/admin/instance-stats`,
  run the collector once, and confirm the `System` tab charts and the
  `Alert settings` tab (save + "Send test email") work before and after
  `INSTANCE_STATS_ENABLED` toggling.
