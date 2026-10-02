#!/usr/bin/env bash
# Run the map — one process (backend/app/map_server.py) serving the built map + lookups.
# Works offline for the map itself; lookups and the business-type list need internet.
#
#   ./run.sh                 start on http://localhost:8000 (next free port if busy) and open it
#   ./run.sh --no-open       don't open a browser (used by the Mac mini auto-start)
#   PORT=8123 ./run.sh       choose the port; with --strict-port it must be free
#
# Binds to 127.0.0.1 only. Reach it from your other devices through Tailscale:
#   tailscale serve --bg 8000      (see scripts/macmini/install-autostart.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

OPEN=1
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    --strict-port) STRICT=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -x "$ROOT/backend/.venv-server/bin/uvicorn" ] || [ ! -f "$ROOT/frontend/dist-local/index.html" ]; then
  echo "Not set up yet — run ./setup.sh first." >&2
  exit 1
fi

# ADJUSTABLE: default port. Tailscale serve is pointed at this port on the Mac mini.
PORT="${PORT:-8000}"
in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
if in_use "$PORT"; then
  if [ "$STRICT" = 1 ]; then
    echo "Port $PORT is already in use." >&2
    exit 1
  fi
  while in_use "$PORT"; do PORT=$((PORT + 1)); done
fi

URL="http://localhost:$PORT"
echo "City map → $URL   (Ctrl+C to stop)"
if [ "$OPEN" = 1 ]; then
  (sleep 2 && open "$URL") &
fi
cd "$ROOT/backend"
exec .venv-server/bin/uvicorn app.map_server:app --host 127.0.0.1 --port "$PORT"
