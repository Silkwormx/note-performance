#!/usr/bin/env bash
# Experimental, local only: scan a sheet-music image (PNG/JPG/PDF) into MusicXML, then
# convert it for the player.
#   usage: tools/scan.sh [--engine audiveris|oemer] page.png [out-basename]
# Writes out-basename.musicxml (open it in the player with "Open song…") and out-basename.txt.
#
# Engines (both run offline):
#   audiveris  Best results in our tests (88–100% of notes, about 5–10 s per page). AGPL-3.0:
#              fine as a local tool, but it must not be bundled into a closed-source paid app.
#              Set AUDIVERIS_BIN, or put the Linux .deb contents under ~/.cache/note-performance/audiveris.
#   oemer      MIT (OK to ship), but erratic in our tests: 93–100% on scan-like images, 3–77% on
#              clean digital pages; about 2 minutes per page on 8 CPU cores. First run sets up
#              Python 3.12 with uv. See tools/SCANNING.md.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
engine=""
if [ "${1:-}" = "--engine" ]; then engine="$2"; shift 2; fi
img="${1:?usage: tools/scan.sh [--engine audiveris|oemer] page.png [out-basename]}"
base="${2:-${img%.*}}"
AUD="${AUDIVERIS_BIN:-$HOME/.cache/note-performance/audiveris/opt/audiveris/bin/Audiveris}"
VENV="${SCAN_VENV:-$HOME/.cache/note-performance/oemer-venv}"
if [ -z "$engine" ]; then
  if [ -x "$AUD" ]; then engine=audiveris; else engine=oemer; fi
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
ext="${img##*.}"
cp "$img" "$tmp/page.$ext"
start=$(date +%s)

if [ "$engine" = "audiveris" ]; then
  [ -x "$AUD" ] || { echo "Audiveris not found at $AUD (set AUDIVERIS_BIN)." >&2; exit 1; }
  "$AUD" -batch -export -output "$tmp" "$tmp/page.$ext" >"$tmp/engine.log" 2>&1 || { tail -20 "$tmp/engine.log" >&2; exit 1; }
  out="$(ls "$tmp"/*.mxl 2>/dev/null | head -1)"
  [ -n "$out" ] || { echo "Audiveris found no music on this page." >&2; tail -20 "$tmp/engine.log" >&2; exit 1; }
  cp "$out" "$base.mxl"
  result="$base.mxl"
else
  if [ ! -x "$VENV/bin/oemer" ]; then
    command -v uv >/dev/null || { echo "Needs uv (https://docs.astral.sh/uv/) to set up Python 3.12." >&2; exit 1; }
    echo "Setting up oemer in $VENV (one time)…" >&2
    uv venv -q -p 3.12 "$VENV"
    VIRTUAL_ENV="$VENV" uv pip install -q oemer
    # oemer 0.1.8's models fail on onnxruntime >= 1.20 ("pads must not contain negative values"),
    # and its line finder breaks on OpenCV 5. Pin versions that work.
    VIRTUAL_ENV="$VENV" uv pip uninstall -q onnxruntime-gpu opencv-python-headless || true
    VIRTUAL_ENV="$VENV" uv pip install -q --reinstall "onnxruntime==1.19.2" "opencv-python==4.10.0.84"
  fi
  "$VENV/bin/oemer" -o "$tmp" "$tmp/page.$ext" >"$tmp/engine.log" 2>&1 || { tail -20 "$tmp/engine.log" >&2; exit 1; }
  cp "$tmp/page.musicxml" "$base.musicxml"
  result="$base.musicxml"
fi
echo "$engine finished in $(( $(date +%s) - start ))s" >&2
node "$here/tools/musicxml-to-song.mjs" "$result" "$base.txt"
echo "Wrote $result and $base.txt" >&2
