# LanguageTool server (Docker Compose)

Standalone [LanguageTool](https://languagetool.org) grammar-check server used by
the Overleaf integration in `services/web/modules/languagetool`
(Overleaf CE fork repo, see the module's `README.md`).

- **Image:** `erikvl87/languagetool:latest` (community server fork of LanguageTool;
  supports `level=default` and `level=picky` — other levels return HTTP 400)
- **Container name:** `languagetool` (overleaf reaches it by this hostname on the shared network)
- **Host port:** `127.0.0.1:32768` → container `8010` (pinned, stable across restarts)
- **Compose project name:** `languagetools_server_compose` (directory name)

## Layout

```
tools/languagetools_server_compose/
├── compose.yaml            # top-level: `extends` the service in languagetool/compose.yaml
├── up.sh                   # docker compose up -d
├── down.sh                 # docker compose down
├── up_languagetool.sh      # docker compose up -d languagetool
├── down_languagetool.sh    # docker compose down languagetool
├── logs_languagetool.sh    # docker compose logs -f languagetool
├── autoupdate_languagetool.sh   # pull latest image, recreate container only if changed
├── lt-test.tex             # test document: sentences with verified expected detections
└── languagetool/
    ├── compose.yaml        # actual service definition
    ├── download_ngrams.sh          # main n-gram set  (de en es fr nl)  → ngrams/
    ├── download_ngrams_untested.sh # untested set      (he it ru zh)    → ngrams/untested/
    └── ngrams/             # n-gram data, mounted read-only into the container (gitignored)
```

## Quick start

```bash
cd tools/languagetools_server_compose

# 1. Populate n-gram data (one-time, ~45 GB disk; resumable, idempotent)
./languagetool/download_ngrams.sh
./languagetool/download_ngrams_untested.sh   # optional: he/it/ru/zh

# 2. Start
./up.sh

# 3. Verify (container must be healthy)
docker ps --filter name=languagetool
curl -s http://127.0.0.1:32768/v2/languages | head -c 200
```

## N-gram data

LanguageTool loads per-language n-gram models from the directory given in
`langtool_languageModel` (here: `/ngrams` ← `languagetool/ngrams/`).
Every subdirectory named after a language code (e.g. `en/`, `de/`) is picked
up — currently present: `de en es fr nl` (main) and `he it ru zh` (untested).

| Set | Languages | Size (extracted) | Zip sources |
|---|---|---|---|
| main | de en es fr nl | ~24 GB | `ngrams-<lang>-YYYYMMDD.zip` (~1.7–9 GB each) |
| untested | he it ru zh | ~14 GB | `ngram-<lang>-YYYYMMDD.zip` (~0.2–2.3 GB each) |

- Downloads come from `https://languagetool.org/download/ngram-data/`
  (untested set: `.../ngram-data/untested/`).
- Both scripts are idempotent: existing zips are skip-validated (`unzip -t`),
  downloads are resumable (`curl -C -`). Re-run safely after an interrupted transfer.
- The downloaded zip archives stay in `ngrams/` (~21 GB total).
  Safe to `rm ngrams/*.zip` once extraction succeeded, to reclaim that space.
- `an` (Aragonese) is **not** available on the server; it is kept commented
  out in `download_ngrams_untested.sh` in case it appears later.

> **Pitfall (cost us a debugging session):** if `ngrams/` does not exist on
> the host, Docker creates an *empty* directory for the bind mount and the
> server runs **without any n-gram models** — spelling detection
> (`recieve`, `realy`, …) silently degrades while the API still answers.
> Verify with `ls languagetool/ngrams/en` and a check request that
> `MORFOLOGIK_RULE_EN_US` still fires.

## Service configuration (`languagetool/compose.yaml`)

| Setting | Value | Notes |
|---|---|---|
| `image` | `erikvl87/languagetool:latest` | community fork, HTTP REST API on 8010 |
| `Java_Xms` / `Java_Xmx` | `512m` / `2g` | JVM heap |
| `langtool_languageModel` | `/ngrams` | n-gram model directory (read-only bind mount) |
| `ports` | `127.0.0.1:32768:8010` | host port pinned — do not reintroduce the ephemeral `127.0.0.1::8010` form |
| `healthcheck` | `wget --spider http://localhost:8010/v2/languages` | 30s interval, 60s start period |
| `restart` | `unless-stopped` | |

## Connecting Overleaf

The matching Overleaf side (CE fork v6.3.1) exposes the feature through
`services/web/modules/languagetool/` — enabled via overleaf service env vars.
In this deployment they live in `/data_1/docker/compose/overleaf/compose.yaml`:

```yaml
env:
  LANGUAGE_TOOL_ENABLED: "true"
  LANGUAGE_TOOL_HOST: languagetool   # resolves on the shared docker network
  LANGUAGE_TOOL_PORT: "8010"
```

- The overleaf container reaches LT through the shared network
  (`languagetools_server_compose_default`); from inside overleaf the host is
  `languagetool:8010`, from the host it is `127.0.0.1:32768`.
- Overleaf checks `/v2/check` (POST, form-encoded `text`, `language`, `level`,
  plus `disabledRules`); client-side defaults: **picky level on**,
  spellcheck language = Overleaf default (`en-US`), and the checks are
  stored as **project settings** (shared with collaborators).
- If `LANGUAGE_TOOL_ENABLED` is false or the proxy can't reach LT, Overleaf
  simply does not offer the feature (no client errors).

## Verification

```bash
# basic
curl -s -X POST http://127.0.0.1:32768/v2/check \
  -d 'language=en-US' -d 'text=You can recieve a bonus.' -d 'level=picky'

# picky vs default (passive voice is picky-only on this build)
curl -s -X POST http://127.0.0.1:32768/v2/check \
  --data-urlencode 'language=en-US' --data-urlencode 'text=The error was detected by the test suite.' \
  -d 'level=default'   # → no passive-voice match
curl -s -X POST http://127.0.0.1:32768/v2/check \
  --data-urlencode 'language=en-US' --data-urlencode 'text=The error was detected by the test suite.' \
  -d 'level=picky'     # → PASSIVE_VOICE_SIMPLE
```

Editor test document: **`lt-test.tex`** in this directory.
Verified expectations (2026-10-26, with the exact `disabledRules` the proxy sends):

| Picky mode | Underlines |
|---|---|
| **on** (Overleaf default) | **27** — section A (2 passive-voice) + section B (23) |
| **off** | **25** — section A disappears, section B stays |

See the file header for the per-sentence rule annotations.

## Update / rollback

```bash
./autoupdate_languagetool.sh   # pull erikvl87/languagetool:latest, recreate only if image changed
docker compose down && docker compose up -d        # manual restart
docker compose logs -f languagetool                # tail logs
```

Troubleshooting:

- **Overleaf can't reach LT** — from the overleaf container:
  `wget -O- http://languagetool:8010/v2/languages`. If DNS fails, the overleaf
  service is not attached to the `languagetools_server_compose_default` network
  (see the two `networks` blocks above; both must carry the same name).
- **Port changed after a recreate** — always use the pinned form
  `"127.0.0.1:32768:8010"`; the old `"127.0.0.1::8010"` form picks a random
  host port per container creation.
- **No spelling detections** — n-gram mount empty, see the pitfall above.

