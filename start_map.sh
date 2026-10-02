#!/usr/bin/env bash
# DEVELOPMENT: Vite with hot reload (:5173) + the map server for /api (:8000). No Docker.
# For everyday use (and the Mac mini) use ./run.sh instead — one process, built map.
#
#   ./start_map.sh            → map at http://localhost:5173, API at :8000
#   Ctrl+C                    → stops both
#
# API keys: put GOOGLE_PLACES_API_KEY / FOURSQUARE_API_KEY in the project-root .env.
# Without keys the map still works; business phones just show "no listing found".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# ADJUSTABLE: ports. If 8000 is taken, change PHONE_PORT — the map is told the new URL below.
PHONE_PORT="${PHONE_PORT:-8000}"
MAP_PORT="${MAP_PORT:-5173}"

if [ ! -x "$ROOT/backend/.venv-server/bin/uvicorn" ]; then
  echo "Creating the server environment (one time)…"
  python3 -m venv "$ROOT/backend/.venv-server"
  "$ROOT/backend/.venv-server/bin/pip3" install -q -r "$ROOT/backend/requirements-server.txt"
fi

cd "$ROOT/backend"
# MAP_DIST_DIR="" → API only; in dev Vite serves the (unbuilt, hot-reloading) map.
MAP_DIST_DIR="" .venv-server/bin/uvicorn app.map_server:app --host 127.0.0.1 --port "$PHONE_PORT" &
PHONE_PID=$!
trap 'kill $PHONE_PID 2>/dev/null' EXIT INT TERM

sleep 1
echo "Phone providers configured: $(curl -s "http://127.0.0.1:$PHONE_PORT/health" || echo 'server not responding')"

cd "$ROOT/frontend"
VITE_STATIC_MODE=true VITE_PHONE_API_URL="http://localhost:$PHONE_PORT/api/v1" \
  npx vite --port "$MAP_PORT" --open
