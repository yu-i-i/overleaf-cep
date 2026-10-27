# overleaf-cep monitoring (Prometheus + Grafana + exporters)

Stack in `/data_1/docker/compose` (modeled on the OlliTeX toolkit compose from
`/data_1/image_mining/the_diff/overleaf/toolkit/compose.yaml`), all of it served
through the existing nginx facade. Container/service names are unprefixed
(monitoring-only, added 2026-10-27; renamed from `ollitex-*` on 2026-10-27).

## Services (all on the shared external network `overleaf-network`)

| service                        | role                                                                 |
|--------------------------------|----------------------------------------------------------------------|
| `prometheus`           | TSDB, 15d retention, `127.0.0.1:9090` (SSH-tunnel/admin only)        |
| `grafana`              | UI, **no host port** — served under `https://<site>/grafana/`        |
| `mongodb-exporter`     | percona exporter for the stack Mongo (sharelatex db)                 |
| `mongodb-exporter-probe` | busybox spider: /metrics must answer (exporter image has no shell)   |
| `redis-exporter`       | oliver006 exporter for the stack Redis                               |
| `redis-exporter-probe` | busybox spider for the redis exporter /metrics                       |
| `mongo-probe`          | mongosh ping — protocol-level Mongo liveness (stack's own image)     |
| `node-exporter`        | host CPU/mem/fs signals (reads host `/`, `/proc`, `/sys` ro)         |
| `instance-sensor`      | **PR yu-i-i/overleaf-cep#178 sensors as live gauges** (see below)    |

The repo's own helpers `down_grafana.sh` / `exec_grafana.sh` now address this
`grafana` service directly.

## What is measured

1. **Overleaf app sensors** — the sharelatex image ships `@overleaf/metrics`
   on the web process (`overleaf:3000/metrics`, `app="web-api"`):
   `num_active_users` (live editor users), `timer_http_request` (summaries with
   quantiles), `mongo_command_started`, `nodejs_eventloop_lag_*`, GC/heap,
   `security_http_auth_check_credentials`, `editor_join_project`,
   `tpds_add_doc`, `lock_mongoTransaction_*`. (In-image side processes like
   compile `:4000` bind 127.0.0.1 inside their container — not scrapable.)
2. **Instance stats — PR #178, integrated into Prometheus/Grafana instead of
   the admin page** (`instance-sensor`, port 9464):
   - users: total + active(24h) — optional standard/guest split via
     `INSTANCE_STATS_SEGMENTATION=true` (PR#176 rule: `'guest-user'` in
     `users.adminRoles`)
   - projects: total + active(24h, `lastUpdated`)
   - files: total docs
   - storage: mongodb `dbStats.totalSize`, filestore `du` of
     `seaweedfs-volume/data` (ro), redis RAM (`used_memory`) + redis disk
     (AOF size)
   Computed fresh on every scrape (no hourly Mongo snapshot state).
3. **MongoDB** — connections, per-db data/storage size, oplog free space.
4. **Redis** — memory, clients, command rate, keyspace hit/miss, AOF.
5. **Host** — CPU, memory, root fs, load, uptime, network.
6. **Filestore (SeaweedFS master `:9327`, native prometheus)** — leader,
   under-replicated volumes, in-flight uploads/downloads.
7. **Scrape self-health** — `up` per job + the monitoring stack itself.

## URLs / access

- Grafana: `https://psintern.neuro.uni-bremen.de/grafana/`
  login: `admin` / (see top section of `.env`, `GRAFANA_ADMIN_USER/PASSWORD`;
  unset → Grafana fallback `admin`/`admin`)
- Prometheus: `http://127.0.0.1:9090` (local only — SSH tunnel from a laptop)
- Dashboard: folder **Overleaf** → **Overleaf — instance overview**
  (file-provisioned; pinned datasource uid `prometheus`,
  `grafana/provisioning/datasources/prometheus.yml`)

## Git hygiene

Data directories are git-ignored per folder: `grafana/.gitignore` →
`grafana-data`, `prometheus/.gitignore` → `prometheus-data` (verified with
`git check-ignore`). `.env` itself is in the root `.gitignore`. Keep new
runtime dirs out of git by adding one line to the folder `.gitignore` as you
add them.

## SMTP

Grafana reuses the stack's Overleaf relay — **no separate Grafana mail vars**;
`grafana/compose.yaml` reads the existing Overleaf settings as a single
source of truth:

| Grafana setting                    | taken from                    |
|---|--------------------------------|
| `GF_SMTP_ENABLED=true`             | fixed                          |
| `GF_SMTP_HOST`                     | `OVERLEAF_EMAIL_SMTP_HOST`:`OVERLEAF_EMAIL_SMTP_PORT` |
| `GF_SMTP_USER`                     | `OVERLEAF_EMAIL_SMTP_USER`     |
| `GF_SMTP_PASSWORD`                 | `OVERLEAF_EMAIL_PASSWORD`      |
| `GF_SMTP_FROM_ADDRESS`             | `OVERLEAF_EMAIL_FROM_ADDRESS`  |
| `GF_SMTP_FROM_NAME`                | `"Overleaf Monitoring"` (display label only) |
| `GF_SMTP_SKIP_VERIFY=false`        | fixed                          |

Used for Grafana's reset-password mail (verified live: sent via the relay,
server responded `200 {"message":"Email sent"}`). Grafana 11's alerting has no
built-in SMTP contact point — SMTP covers account e-mail; alert routing would
need integrations (webhook/Slack/…).

**Gotcha (learned 2026-10-27): the admin account's email must be set.**
Grafana creates the admin user with email `admin@localhost`; the reset-mail
endpoint `POST /api/user/password/send-reset-email {"userOrEmail": …}` matches
users by that email and answers `200 "Email sent"` *even when nobody matches*
(anti user-enumeration) — so it silently sends nothing. Fixed on two layers:
1. **self-healing on fresh data**: `GF_SECURITY_ADMIN_EMAIL` in
   `grafana/compose.yaml` = `${OVERLEAF_ADMIN_EMAIL:-overleaf@uni-bremen.de}` —
   honored only when Grafana *creates* the admin (i.e. after a grafana-data
   wipe); it never rewrites an existing user row.
2. **existing install**: `update user set email='overleaf@uni-bremen.de'
   where login='admin'` in `grafana-data/grafana.db` (grafana stopped).
Verify with `select email from user where login='admin'`. The working relay
itself was proven with a raw `smtplib.SMTP_SSL` test (TLS-465 + auth + RCPT all OK).

**After a grafana-data wipe** (fresh admin creation): login =
`GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD` from `.env`; e-mail = `GF_SECURITY_ADMIN_EMAIL`
(default `overleaf@uni-bremen.de`); dashboards re-provision automatically
(file provider); admin UI settings/annotations are lost.

To disable SMTP: set `GF_SMTP_ENABLED: "false"` in `grafana/compose.yaml` +
`docker compose up -d grafana`.

## Ops notes / gotchas (learned while bringing this up)

- **percona/mongodb_exporter 0.43 ships most collectors OFF by default**
  (a default run answers only `mongodb_up` + go/process metrics). Working
  flags for this stack are in `mongodb-exporter/compose.yaml`:
  `--collector.diagnosticdata --collector.dbstats --collector.dbstatsfreestorage
  --collector.replicasetstatus` (verified against this mongo 9.0).
- Bind-mount ownership: `prometheus/prometheus-data` must be owned by uid
  **65534**, `grafana/grafana-data` by uid **472** (both images run
  unprivileged; docker creates fresh bind-mount dirs as root). Pre-create +
  `chown` if the dirs are ever deleted.
- Grafana subpath: `GF_SERVER_SERVE_FROM_SUB_PATH=true` +
  `GF_SERVER_ROOT_URL=https://<site>/grafana/` — nginx serves `/grafana/`
  **without stripping** the prefix (see `nginx/nginx.conf`).
  After editing `nginx.conf`: `docker exec nginx nginx -s reload` (conf is
  bind-mounted, not baked in).
- Grafana 11 login via API: `POST /grafana/login` with **JSON**
  `{user, password}` (the old `POST /api/login` is gone; form-encoded POSTs
  return `form-auth.invalid`).
- Healthchecks: compose interpolates `${VAR}` inside healthcheck strings at
  load time — `MONGO_HOSTNAME`/`MONGO_PORT` therefore live in `.env`.
- The `instance-sensor` image is a local build:
  `docker build -t overleaf-instance-sensor:local ./instance-sensor`.

## Adding/retiring

Everything opt-in per service; remove a block from the root `compose.yaml`
and `docker compose <svc> down` to retire one. Image pins: `.env`
(commented block in the monitoring section).
