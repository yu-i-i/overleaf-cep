#!/usr/bin/env bash
# up.sh — cold/hot start of the whole stack, wakapi-safe ordering:
#   1) wakapi-pg up, drop the normalization trigger (if any) so wakapi's
#      pending startup DDL can never be blocked by it (SQLSTATE 0A000 brick —
#      see 0_ensure_local_auth_type.sh header).
#   2) rest of the stack up (overleaf included, so its IP becomes known).
#   3) pin OVERLEAF_IP (was valid only while overleaf was running before).
#   4) recreate wakapi — automatically, only if the pin changed it.
#   5) re-apply trigger + backfill (no-op if the DB is already normalized).
set -euo pipefail
cd "$(dirname "$0")"

# 1) pg first + trigger removed for the startup window
docker compose up -d wakapi-pg
bash 0_ensure_local_auth_type.sh preflight

# 2) everything else (.env may carry a stale OVERLEAF_IP; corrected in 3)
docker compose up -d

# 3) pin OVERLEAF_IP to the now-known overleaf container IP (single-IP
#    least-privilege trusted-source model for wakapi)
ip="$(docker inspect -f '{{(index .NetworkSettings.Networks "overleaf-network").IPAddress}}' overleaf)"
grep -q '^OVERLEAF_IP=' .env && sed -i "s/^OVERLEAF_IP=.*/OVERLEAF_IP=$ip/" .env || echo "OVERLEAF_IP=$ip" >> .env
echo "pinned OVERLEAF_IP=$ip"

# 4) pick up the new pin if it changed (no-op otherwise; heartbeats in the
#    2→4 window may be rejected — fire-and-forget client, self-heals)
docker compose up -d wakapi

# 5) normalization back on (waits until wakapi serves)
bash 0_ensure_local_auth_type.sh apply
