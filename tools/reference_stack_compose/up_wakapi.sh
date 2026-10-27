#!/usr/bin/env bash
# up_wakapi.sh — start/re-warm only the wakapi pair (hot-stack tooling:
# expects overleaf to be running for the IP pin). Same trigger-safe cycle as
# up.sh: preflight drop -> up -> apply.
set -euo pipefail
cd "$(dirname "$0")"

docker compose up -d wakapi-pg
bash 0_ensure_local_auth_type.sh preflight

ip="$(docker inspect -f '{{(index .NetworkSettings.Networks "overleaf-network").IPAddress}}' overleaf)"
grep -q '^OVERLEAF_IP=' .env && sed -i "s/^OVERLEAF_IP=.*/OVERLEAF_IP=$ip/" .env || echo "OVERLEAF_IP=$ip" >> .env
echo "pinned OVERLEAF_IP=$ip"

docker compose up -d wakapi
bash 0_ensure_local_auth_type.sh apply
