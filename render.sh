#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -d node_modules/playwright ]]; then
  echo "Installing Playwright (using system Chrome)..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
fi
exec node render.mjs "$@"
