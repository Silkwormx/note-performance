#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "Mario player:  http://127.0.0.1:${PORT}/"
echo "Song editor:   http://127.0.0.1:${PORT}/editor.html"
echo "This page needs to be served over http (don't open the file directly)."
exec python3 -m http.server "$PORT" --bind 127.0.0.1
