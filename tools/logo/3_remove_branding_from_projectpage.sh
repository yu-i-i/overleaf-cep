#!/usr/bin/env bash
set -euo pipefail
# Removes the "Digital Science" branding block from the sidebar lower-section component.
# Usage: bash 3_remove_branding_from_projectpage.sh
TARGET="../../services/web/frontend/js/shared/components/sidebar/sidebar-lower-section.tsx"
BACKUP="$TARGET.bak"

if [ ! -f "$TARGET" ]; then
  echo "ERROR: target file not found: $TARGET"
  exit 1
fi

echo "Creating backup: $BACKUP"
cp -a "$TARGET" "$BACKUP"

# Use Perl to remove the smallest enclosing <div ...>...</div> block that contains
# the text "Digital Science", across multiple lines, regardless of attribute order/whitespace.
# Note: this is a non-greedy match on the *first* closing </div> after the text, so it
# assumes the "Digital Science" text is not itself wrapped in nested <div> elements before
# its own closing tag. If the branding markup nests divs internally, this may not capture
# the full block correctly — inspect the diff below carefully.
perl -0777 -pe "s#<div[^>]*>(?:(?!<div|</div>).)*?Digital Science(?:(?!<div|</div>).)*?</div>\\n?##gis" "$BACKUP" > "$TARGET"

if cmp -s "$TARGET" "$BACKUP"; then
  echo "No block containing 'Digital Science' found; no changes made."
  exit 0
else
  echo "✓ Removed block containing 'Digital Science' from $TARGET"
  echo ""
  echo "Diff of changes:"
  diff -u "$BACKUP" "$TARGET" || true
  exit 0
fi
