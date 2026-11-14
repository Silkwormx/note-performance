#!/usr/bin/env bash
# Start the scan backend and a free Cloudflare quick tunnel, then print the phone link.
#   server/start.sh          start (or restart) both
#   server/start.sh stop     stop both
#   server/start.sh status   show the current link
# The tunnel address changes every time it starts. The access key stays the same
# (it lives in server/.env, which is git-ignored).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CACHE="${NP_CACHE:-$HOME/.cache/note-performance}"
PORT="${SCAN_PORT:-8840}"
HOST="${SCAN_HOST:-127.0.0.1}"  # 0.0.0.0 lets phones on the same Wi-Fi connect directly
RUN="$CACHE/run"
mkdir -p "$RUN"

stop() {
  for n in tunnel server; do
    if [ -f "$RUN/$n.pid" ]; then
      pid="$(cat "$RUN/$n.pid")"
      kill "$pid" 2>/dev/null || true
      rm -f "$RUN/$n.pid"
    fi
  done
}

status() {
  local ok=no
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && ok=yes
  echo "Backend on port $PORT running: $ok"
  if [ -s "$HERE/current_url.txt" ]; then
    echo "Phone link: $(cat "$HERE/current_url.txt")"
  fi
}

case "${1:-start}" in
  stop) stop; echo "Stopped."; exit 0 ;;
  status) status; exit 0 ;;
esac

"$HERE/install.sh"

if [ ! -s "$HERE/.env" ]; then
  key="$("$CACHE/scan-server-venv/bin/python" -c 'import secrets; print(secrets.token_urlsafe(12))')"
  printf '# Access key for the scan backend. Never commit this file.\nSCAN_KEY=%s\n' "$key" > "$HERE/.env"
  chmod 600 "$HERE/.env"
fi
KEY="$(sed -n 's/^SCAN_KEY=//p' "$HERE/.env")"

stop
cd "$HERE"
setsid nohup "$CACHE/scan-server-venv/bin/python" -m uvicorn app:app --host "$HOST" --port "$PORT" \
  >"$RUN/server.log" 2>&1 < /dev/null &
echo $! > "$RUN/server.pid"
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "Backend didn't start; see $RUN/server.log" >&2; exit 1; }

: > "$RUN/tunnel.log"
echo "http://127.0.0.1:$PORT/scan.html?key=$KEY" > "$HERE/current_url.txt"
if [ "${SCAN_TUNNEL:-cloudflare}" = "none" ]; then
  echo "Scanner is running (no tunnel): http://127.0.0.1:$PORT/scan.html?key=$KEY"
  exit 0
fi
setsid nohup "$CACHE/cloudflared" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" \
  >"$RUN/tunnel.log" 2>&1 < /dev/null &
echo $! > "$RUN/tunnel.pid"
URL=""
for _ in $(seq 1 60); do
  # the address is printed before the tunnel is connected; wait for "Registered tunnel connection"
  if grep -q 'Registered tunnel connection' "$RUN/tunnel.log"; then
    URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN/tunnel.log" | head -1 || true)"
    break
  fi
  sleep 1
done
if [ -z "$URL" ]; then
  kill "$(cat "$RUN/tunnel.pid")" 2>/dev/null || true
  rm -f "$RUN/tunnel.pid"
  echo
  echo "The scanner is running, but the phone tunnel couldn't connect (see $RUN/tunnel.log)."
  echo "Cloudflare tunnels need outgoing port 7844; some networks block it."
  echo "On this computer: http://127.0.0.1:$PORT/scan.html?key=$KEY"
  exit 2
fi
LINK="$URL/scan.html?key=$KEY"
echo "$LINK" > "$HERE/current_url.txt"
echo
echo "Scanner is running."
echo "Open this on your phone (it remembers the key after the first visit):"
echo "  $LINK"
echo "On this computer: http://127.0.0.1:$PORT/scan.html?key=$KEY"
