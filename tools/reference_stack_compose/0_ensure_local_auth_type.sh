#!/usr/bin/env bash
# 0_ensure_local_auth_type.sh — manage wakapi's users-table normalization
# (wakapi/ensure_local_auth_type.sql: trigger + one-time backfill).
#
# MODES
#   preflight  Drop the trigger (no-op if absent / if the table doesn't
#              exist yet). Run BEFORE starting or recreating wakapi.
#   apply      Wait for wakapi to serve, then (re)apply trigger + backfill.
#              Run AFTER wakapi is up. This is the default mode.
#
# WHY (twice-learned rule, 2026-10-26):
#   A trigger referencing `users` BLOCKS wakapi's pending startup DDL —
#   `ERROR: cannot alter type of a column used in a trigger definition
#   (SQLSTATE 0A000)` — and wakapi crashloops until the trigger is gone.
#   The batches are recorded per-run; while any of them is unrecorded, EVERY
#   startup re-runs the batch and can hit the collision. So the only safe
#   cycle is:  drop -> wakapi up (batch runs free, records) -> apply.
#   up.sh and up_wakapi.sh do exactly this. Rows written during the short
#   window without the trigger are covered by the apply-time backfill.
#
# The SQL itself is idempotent (create or replace / drop if exists /
# guarded updates), so the dance costs a few SQL statements per `up`.
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-apply}"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

die() { echo "ERROR: $*" >&2; exit 1; }

PGCLIENT="docker run --rm --network overleaf-network -e PGPASSWORD=${PG_PASSWORD}
  -e PGUSER=${WAKAPI_DB_USER:-wakapi} -e PGDATABASE=${WAKAPI_DB_NAME:-wakapi}
  ${POSTGRES_IMAGE}"

wait_pg() {
  for i in $(seq 1 60); do
    ${PGCLIENT} sh -c 'pg_isready -h wakapi-pg -p 5432' >/dev/null 2>&1 && return 0
    sleep 2
  done
  die "wakapi-pg not accepting connections after 120s"
}

case "$MODE" in
preflight)
  echo "[preflight/1] waiting for wakapi-pg (needed to drop the trigger)..."
  wait_pg
  echo "[preflight/2] dropping normalization trigger (if any) so wakapi startup DDL can run..."
  ${PGCLIENT} psql -h wakapi-pg -p 5432 -v ON_ERROR_STOP=1 -c \
    "do \$\$ begin execute 'drop trigger if exists trg_wakapi_normalize_local_auth on users'; exception when undefined_object then null; end \$\$;" \
    >/dev/null
  echo "[preflight] done (no-op if the trigger wasn't there)"
  ;;
apply)
  echo "[1/3] waiting for wakapi-pg to accept connections..."
  wait_pg

  echo "[2/3] waiting for users table + wakapi serving (startup migrations complete)..."
  READY=0
  for i in $(seq 1 90); do
    TBL=$( ${PGCLIENT} psql -h wakapi-pg -p 5432 -tAq -c "select to_regclass('public.users')")
    if [ "$TBL" = "users" ] \
       && docker run --rm --network overleaf-network ${PROBE_IMAGE} \
            wget -q --spider http://wakapi:3000/login >/dev/null 2>&1; then
      READY=1; break
    fi
    sleep 2
  done
  [ "$READY" = "1" ] \
    || die "users table or wakapi not ready/serving after 180s — check: bash logs_wakapi.sh (look for 'migration failed')"

  echo "[3/3] applying wakapi/ensure_local_auth_type.sql ..."
  docker run --rm --network overleaf-network \
    -e PGPASSWORD="${PG_PASSWORD}" \
    -e PGUSER="${WAKAPI_DB_USER:-wakapi}" \
    -e PGDATABASE="${WAKAPI_DB_NAME:-wakapi}" \
    -v "$(pwd)/wakapi/ensure_local_auth_type.sql:/init.sql:ro" \
    ${POSTGRES_IMAGE} \
    psql -h wakapi-pg -p 5432 -v ON_ERROR_STOP=1 -f /init.sql

  echo "active trigger(s) on users:"
  ${PGCLIENT} psql -h wakapi-pg -p 5432 -tAq \
    -c "select '  '||tgname from pg_trigger where tgrelid='public.users'::regclass and not tgisinternal order by 1"
  echo "OK — local-auth normalization is active (staff 'Forgot password?' path works)."
  ;;
*)
  die "unknown mode '$MODE' (expected: preflight | apply)"
  ;;
esac
