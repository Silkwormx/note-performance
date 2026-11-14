#!/usr/bin/env bash
# One-time setup for the scan backend (Linux x86-64). Safe to re-run.
# Installs into ~/.cache/note-performance: Python venv, Audiveris 5.11 (with its own Java),
# English OCR data (so chord names and lyrics are read) and cloudflared.
set -euo pipefail
CACHE="${NP_CACHE:-$HOME/.cache/note-performance}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$CACHE"
cd "$CACHE"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Please install $1 first." >&2; exit 1; }; }
need curl
need pdftoppm || true

if [ ! -x scan-server-venv/bin/python ]; then
  echo "• Python environment"
  if command -v uv >/dev/null; then
    uv venv -q -p 3.12 scan-server-venv
    VIRTUAL_ENV=scan-server-venv uv pip install -q -r "$HERE/requirements.txt"
  else
    python3 -m venv scan-server-venv
    scan-server-venv/bin/pip install -q -r "$HERE/requirements.txt"
  fi
fi

if [ ! -x audiveris/opt/audiveris/bin/Audiveris ]; then
  echo "• Audiveris 5.11.0 (AGPL-3.0, runs as a separate program)"
  deb="Audiveris-5.11.0-ubuntu24.04-x86_64.deb"
  [ -f "$deb" ] || curl -fL -o "$deb" "https://github.com/Audiveris/audiveris/releases/download/5.11.0/$deb"
  rm -rf audiveris.tmp && mkdir audiveris.tmp && dpkg-deb -x "$deb" audiveris.tmp
  rm -rf audiveris && mv audiveris.tmp audiveris
fi

if [ ! -s tessdata/eng.traineddata ] || [ "$(stat -c %s tessdata/eng.traineddata)" -lt 10000000 ]; then
  echo "• English OCR data for Audiveris (tessdata, Apache-2.0)"
  mkdir -p tessdata
  # the full model: Audiveris needs the legacy engine parts, which tessdata_fast lacks
  curl -fL -o tessdata/eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
fi

if [ ! -x cloudflared ]; then
  echo "• cloudflared (free quick tunnel, no account)"
  curl -fL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x cloudflared
fi
echo "Setup done."
