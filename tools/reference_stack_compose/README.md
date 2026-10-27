# Overleaf CE — self-hosted stack (`psintern.neuro.uni-bremen.de`)

One Docker Compose project that runs the entire server: Overleaf CE (languagetool CE
fork), its storage backend (MongoDB + Redis + SeaweedFS/S3), Git sync (git-bridge),
grammar checking (LanguageTool), WakaTime-style activity tracking (Wakapi), and the
TLS edge (nginx). Everything runs in the shared external network **`overleaf-network`**.

- Public URL: `https://psintern.neuro.uni-bremen.de` (Overleaf)
- Wakapi UI:   `https://psintern.neuro.uni-bremen.de/wakapi/` (same host, nginx subpath)
- Server source: **not this repo** — the Overleaf image is built from the
  `overleaf-cep` checkout (`ext-ce-v6.3.1` branch); this directory only *deploys*.

---

## 1. Layout

```
compose.yaml            # root project: composes all services below via `extends`,
                        # adds depends_on ordering, declares the external network
<service>/compose.yaml  # one service per directory (see table)
.env                    # ALL configuration incl. secrets — git-ignored, never commit
env.sample              # committed, secret-free template of .env (cp env.sample .env)
0_*.sh                  # one-time setup (run once, in this order)
up_*.sh  down_*.sh      # per-service lifecycle (they cd to the project root themselves)
logs_*.sh  exec_*.sh    # per-service logs / shell
autoupdate_*.sh         # pull next image version for a service (then up_*.sh)
cycle_{nginx,overleaf}.sh
0_ensure_local_auth_type.sh # wakapi users-table normalization trigger, 2 modes:
                        #   preflight — drop trigger (BEFORE wakapi up, unblocks its DDL)
                        #   apply     — trigger + backfill (AFTER wakapi serves, default)
                        # Both run automatically from up.sh / up_wakapi.sh.
                        # Manual: bash 0_ensure_local_auth_type.sh [preflight|apply]
up.sh / down.sh         # the whole project (up.sh first auto-pins OVERLEAF_IP, see §5)
<service>/data*         # live data volumes (mongo, redis, seaweedfs-*, overleaf, ...) — git-ignored
<service>/backup/       # backup dumps (git-ignored)
backup_seaweedfs_online/# timestamped SeaweedFS online backups (git-ignored)
<service>/backup.sh     # mongo/, wakapi-pg/: dump into <service>/backup/
```

### Services

| dir | container | image (env pin) | role |
|---|---|---|---|
| `overleaf/` | `overleaf` | `sharelatex/sharelatex:${OVERLEAF_VERSION}` | the app (CE fork). `./data` = /var/lib/overleaf, `./log` = /var/log/overleaf, docker.sock mounted |
| `mongo/` | `mongo` | `mongo:${MONGO_VERSION}` | documents/projects. Runs as replica set `overleaf`. `./data_db`, `./backup` |
| `redis/` | `redis` | `redis:${REDIS_VERSION}` | sessions/queues. AOF persistence. `./data`, `./backup` |
| `seaweedfs-{master,volume,filer,s3}/` | same | `chrislusf/seaweedfs:latest` | S3-compatible file storage for overleaf (compiles, uploads, exports). Host ports bound to 127.0.0.1 only (9333/19333 master, 18080 volume gRPC, 8888 filer, 8333 S3 API). In-network aliases `master`, `volume`, `filer`, `s3` |
| `git-bridge/` | `git-bridge` | `quay.io/sharelatex/git-bridge:${GIT_BRIDE_VERSION}` | Git export/sync for projects (texlive repo `TEX_LIVE_REPO`) |
| `languagetool/` | `languagetool` | `erikvl87/languagetool:latest` | grammar checking (enabled in overleaf: `LANGUAGE_TOOL_*`); ngram models in `./ngrams` |
| `wakapi-pg/` | `wakapi-pg` | `postgres:${POSTGRES_IMAGE}` | Wakapi's database (db/user `wakapi`, pw `${PG_PASSWORD}`). `./data`, `./backup` |
| `wakapi/` | `wakapi` | `${WAKA_API_IMAGE}` (stock ghcr or local build) | WakaTime-compatible time tracking, self-hosted |
| `wakapi-probe/` | `wakapi-probe` | `${PROBE_IMAGE}` (busybox, `sleep infinity`) | nothing it runs — a *healthcheck-only* container: "HTTP serving" proof for wakapi; nginx depends on it being healthy |
| `nginx/` | `nginx` | `nginx:stable-alpine` | TLS edge (Let's Encrypt files from `SSL_KEY_FILE`/`SSL_CERT_FILE`), ACME dir, serves Overleaf at `/` and Wakapi at `/wakapi/` |

Startup order (enforced by `depends_on: service_healthy` in the root file):
`redis, mongo, seaweedfs-* → overleaf → nginx`; `wakapi-pg → wakapi → wakapi-probe → nginx`;
`git-bridge`, `languagetool` independent.

---

## 2. Configuration (`.env`)

- **`env.sample` is the source of truth for *what keys exist* and what they mean** —
  copy it (values included where safe), then fill the `<PLACEHOLDER>`s. `.env` is
  git-ignored; **never** commit it, and **never** paste values from it into
  `env.sample` (it's the template, not a backup).
- Plain `KEY=value` lines. Compose interpolates `${OTHER_KEY}` between keys, but
  **no shell**: `$(docker ...)`, backticks, `;` do **not** run — a line like
  `FOO=$(cmd)` stores the literal string. (Wakapi, e.g., would then warn and drop it.)
- Secrets in play: AWS S3 keys (SeaweedFS S3 API), Zotero app creds, GitHub App
  creds, Keycloak OIDC client, invite-token secret, Overleaf SMTP password,
  wakapi-pg password. Generator hints are in the comments.
- `OVERLEAF_IP` is **auto-maintained**: `up.sh` / `up_wakapi.sh` rewrite it from
  `docker inspect overleaf` before bringing (re)created containers up. Don't fight it.

---

## 3. First-time setup order

```bash
bash 0_create_network.sh        # overleaf-network + ufw/iptables for it
bash 0_install_aws.sh           # aws cli (for bucket ops)
bash 0_create_s3_buckets.sh     # seaweedfs S3 buckets for overleaf
bash 0_pull_other_containers.sh # image pulls
cp env.sample .env && vi .env   # fill secrets
bash up.sh                      # everything (pins OVERLEAF_IP first)
```

---

## 4. Day-to-day

```bash
bash up_<svc>.sh        # start/recreate one service (mongo, redis, overleaf, nginx,
                        # wakapi, wakapi-pg, wakapi-probe, seaweedfs-*, git-bridge, languagetool)
bash down_<svc>.sh      # stop+remove it
bash logs_<svc>.sh      # follow logs
bash exec_<svc>.sh      # interactive shell (where the image allows)
bash cycle_nginx.sh     # down+up nginx (config change, cert renewal)
bash up.sh              # whole project
# backups
bash mongo/backup.sh             # mongodump -> mongo/backup/
bash wakapi-pg/backup.sh         # pg_dump  -> wakapi-pg/backup/
# see backup_seaweedfs_online/ + 0_online_backup_s3.sh for the seaweedfs side
```

**Image upgrades:** bump the `*_VERSION` / `WAKA_API_IMAGE` pins in `.env`
(or edit the `image:` line in the service's compose.yaml), then `bash up_<svc>.sh` —
compose replaces the container. `autoupdate_*.sh` do the pin-bump for
mongo/redis/nginx/languagetool/seaweedfs.

---

## 5. Special behaviors that are easy to step on

- **Overleaf rebuilds**: the image comes from the `overleaf-cep` checkout
  (`ext-ce-v6.3.1`). Rebuild there (see that repo's `server-ce/` + the
  `rebuild-overleaf-docker-image` skill), tag/push per `.env`'s `OVERLEAF_VERSION`,
  then `bash up_overleaf.sh`. A plain `docker compose up` does **not** swap a
  same-tag image unless pulled/retagged.
- **Wakapi identity model** (no external signup, no per-user keys):
  - `WAKAPI_ALLOW_SIGNUP=false`, trusted-header auth on: Overleaf (the **only** trusted
    source IP — `WAKAPI_TRUST_REVERSE_PROXY_IPS` = `OVERLEAF_IP`) asserts the logged-in
    user's email in `Remote-User`; wakapi auto-creates/identifies the user.
    Hostname values in that list are **silently dropped** by wakapi (IP/CIDR only).
  - Staff get a UI password **self-service**: `…/wakapi/login` → "Forgot password?"
    → reset mail via the university relay (`OVERLEAF_EMAIL_*`, sender
    `overleaf@uni-bremen.de`) → set password. Requires `WAKAPI_PUBLIC_URL`
    (`${OVERLEAF_SITE_URL}/wakapi` — the ship default `http://localhost:3000` would
    mail useless links).
  - **Normalization trigger for trusted-header users** (kept in the DB, not in
    wakapi): `wakapi/ensure_local_auth_type.sql` — a PG trigger on `wakapi-pg`
    rewriting header-created rows to `auth_type='local'` + `email=id`, else
    wakapi refuses the "Forgot password?" reset (routes/login.go).
    **Fully automatic safe cycle** (see `0_ensure_local_auth_type.sh` header):
    `up.sh` / `up_wakapi.sh` first run `preflight` (drop the trigger if present)
    so wakapi's startup DDL can never be blocked by it, start wakapi (pending
    batches run free and record), then `apply` (trigger + backfill — the
    backfill also covers rows written in the short unpinned window). This is
    mandatory while **any** wakapi migration batch is unrecorded: then every
    startup re-runs the batch and hits the trigger (`SQLSTATE 0A000`, the
    2026-10-26 crashloop). Once all batches are recorded the drop/apply dance
    remains a cheap no-cost safety net (e.g. after wipes or wakapi upgrades).
    **Only if you start wakapi manually** outside those scripts
    (`docker compose up -d wakapi`), run the preflight first:
      `bash 0_ensure_local_auth_type.sh preflight`
- **Wakapi base path**: the app serves at `/` and only shapes *generated* URLs with
  `WAKAPI_BASE_PATH=/wakapi`. That's why nginx does
  `location /wakapi/ { proxy_pass http://wakapi:3000/; }` — the **trailing slash**
  strips the prefix. Removing it 404s the UI.
- **nginx strips `Remote-User` on browser traffic** (`proxy_set_header Remote-User ""`)
  so clients cannot inject identities; only the overleaf container (pinned IP) may.
- **mongo** runs `--replSet overleaf` with the init-in-healthcheck trick, and
  `GLIBC_TUNABLES: glibc.cpu.hwcaps=-SHSTK` (CPU feature-hole workaround — don't
  "clean" it).
- **seaweedfs**: four cooperating containers; in-network names are the classic
  `master/filer/volume/s3` (aliases), host ports are loopback-only. The volume
  deliberately does **not** publish 8080 to the host (collision) — keep it that way.
- **Health is load-bearing**: `nginx` waits for `overleaf` + `wakapi-probe`
  (healthchecks) before being healthy; `wakapi-probe` is an idle busybox whose
  healthcheck is the wakapi HTTP probe.
- **UFW/iptables**: `0_create_network.sh` opens the bridge interface — after
  reboots or network recreation, make sure these rules still exist.
- **Cold start fails with `Conflict. The container name "/<svc>" is already in
  use`**: an orphan container from another project (e.g. the old
  `tools/*_server_compose` recipes) still holds the name and `down.sh` didn't
  remove it (it's not this project's). Find it: `docker ps -a --filter name=<svc>`,
  then `docker rm <name>` (volumes, if any, stay on disk) and re-run `up.sh`.

---

## 6. Related locations

- Overleaf server source & build: `overleaf-cep` checkout, branch `ext-ce-v6.3.1`
  (modules: `services/web/modules/{wakime,zotero,track-changes,…}`)
- Wakapi upstream source checkout (for template/feature work against a pinned tag):
  `/data_1/compare/wakapi` (has tags incl. `2.18.2`)
- Skills with the muscle memory for this box:
  `overleaf-dev-server-testing`, `rebuild-overleaf-docker-image`,
  `overleaf-agent-workflows`
