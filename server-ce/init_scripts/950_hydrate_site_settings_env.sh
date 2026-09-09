#!/bin/sh
# R9 §7.4 (2026-08-29): admin-managed site settings (site_settings
# collection) hydrate /etc/overleaf/env.sh BEFORE the runit services
# start — stored admin values override compose env for ALL services
# (web, clsi, …). Idempotent: the managed block is replaced each boot.
# On failure the block is empty and the compose env stands.
set -u

FILE=/etc/overleaf/env.sh
BEGIN='# >>> overleaf site-settings env (managed — do not edit)'
END='# <<< overleaf site-settings env'

# Strip a previous managed block (idempotent across boots).
if [ -f "$FILE" ]; then
  awk -v b="$BEGIN" -v e="$END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip { print }
  ' "$FILE" > "$FILE.tmp" && cat "$FILE.tmp" > "$FILE" && rm -f "$FILE.tmp"
fi

{
  echo "$BEGIN"
  # NOTE: the hydrate node process prints library log lines (Settings,
  # mongoose) to stdout — keep ONLY export/comment lines in env.sh, or
  # `sh . /etc/overleaf/env.sh` fails at service start (2026-08-30 fix).
  if ! /sbin/setuser www-data node /overleaf/services/web/modules/server-ce-scripts/scripts/hydrate-site-settings-env.mjs 2>/tmp/overleaf-hydrate-err.log | grep -E '^(export |#)' >> "$FILE"; then
    echo "# hydration failed (compose env stands); log: /tmp/overleaf-hydrate-err.log" >> "$FILE"
  fi
  echo "$END"
} >> "$FILE"
