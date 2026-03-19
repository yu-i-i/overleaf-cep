#!/usr/bin/env bash

set -eu

echo "--------------------------"
echo "Collect instance statistics"
echo "--------------------------"
date

# `@overleaf/settings` resolves `config/settings.defaults.*` relative to
# `process.cwd()`, so ensure we're running from `services/web`.
cd /overleaf/services/web

node /overleaf/services/web/modules/instance-stats/app/src/collectInstanceStats.mjs

