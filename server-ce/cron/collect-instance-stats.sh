#!/usr/bin/env bash

set -eu

echo "-------------------------"
echo "Collecting instance stats"
echo "-------------------------"
date

WEB_URL='http://127.0.0.1:3000'

# Same private-API credentials as the other cron scripts
# (WEB_API_USER / WEB_API_PASSWORD are set on the container environment).
ARGS=()
if [[ -f /etc/container_environment/WEB_API_USER && -f /etc/container_environment/WEB_API_PASSWORD ]]; then
  USER=$(cat /etc/container_environment/WEB_API_USER)
  PASS=$(cat /etc/container_environment/WEB_API_PASSWORD)
  ARGS+=(-u "${USER}:${PASS}")
else
  echo "WARN: WEB_API_USER/WEB_API_PASSWORD not available; internal route will 401"
fi

curl -fsS -X POST "${ARGS[@]}" \
  "${WEB_URL}/internal/collect-instance-stats" \
  || echo "collect-instance-stats run failed"

echo "Done."
