#!/usr/bin/env bash
set -euo pipefail

# Removes the ds-nav branding block from the project page sidebar component.
# Usage: bash 3_remove_branding_from_projectpage.sh

TARGET="../../services/web/frontend/js/features/project-list/components/sidebar/sidebar-ds-nav.tsx"
BACKUP="$TARGET.bak"

if [ ! -f "$TARGET" ]; then
  echo "ERROR: target file not found: $TARGET"
  exit 1
fi

echo "Creating backup: $BACKUP"
cp -a "$TARGET" "$BACKUP"

# Use Perl to remove the <div ... className="ds-nav-ds-name" ...>...</div> block across multiple lines.
# This will match regardless of attribute order or whitespace and removes the entire div including trailing newline.
perl -0777 -pe "s#<div[^>]*className\\s*=\\s*[\'\"]ds-nav-ds-name[\'\"][^>]*>.*?</div>\\n?##gis" "$BACKUP" > "$TARGET"

if cmp -s "$TARGET" "$BACKUP"; then
  echo "No ds-nav-ds-name block found; no changes made."
  exit 0
else
  echo "✓ Removed ds-nav-ds-name block from $TARGET"
  exit 0
fi
