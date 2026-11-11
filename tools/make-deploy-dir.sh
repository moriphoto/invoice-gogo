#!/bin/sh
# Builds a clean deploy directory (no node_modules, no tests, no screenshots, no secrets).
# Usage: tools/make-deploy-dir.sh /path/to/deploy-dir
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${1:?deploy dir}"
rm -rf "$OUT"; mkdir -p "$OUT/netlify/functions" "$OUT/netlify/lib" "$OUT/vendor"
cd "$SRC"
cp index.html app.js logic.js pdf.js style.css sw.js manifest.webmanifest netlify.toml package.json icon.svg icon-maskable.svg icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png "$OUT/"
cp vendor/jspdf.umd.min.js vendor/jspdf.LICENSE "$OUT/vendor/"
cp netlify/functions/api.mjs "$OUT/netlify/functions/"; cp netlify/lib/handler.mjs netlify/lib/setup-code.mjs "$OUT/netlify/lib/"
echo "deploy dir ready: $OUT"
