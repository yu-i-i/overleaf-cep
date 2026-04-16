#!/bin/bash
# Download BusyTeX WASM assets for online compile
# These are required for browser-based LaTeX compilation
#
# The assets are ~175MB and include WASM binaries for:
# - PdfTeX (pdflatex)
# - XeTeX (xelatex) 
# - LuaHBTeX (lualatex)
# - BibTeX8
# - dvipdfmx
#
# Assets are downloaded to services/web/public/core/busytex/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$(dirname "$(dirname "$MODULE_DIR")")"
PUBLIC_DIR="$WEB_DIR/public"
DEST_DIR="$PUBLIC_DIR/core"

echo "Downloading BusyTeX WASM assets to $DEST_DIR..."

cd "$WEB_DIR"

# Use npx to run the download-assets command from texlyre-busytex
npx texlyre-busytex download-assets "$DEST_DIR"

echo ""
echo "BusyTeX WASM assets downloaded successfully to $DEST_DIR/busytex/"
echo "These files will be served at /core/busytex/ by the web server."
