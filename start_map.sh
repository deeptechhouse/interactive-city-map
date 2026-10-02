#!/usr/bin/env bash
# Start the static-mode map + the phone-only lookup server together (no Docker needed).
#
#   ./start_map.sh            → map at http://localhost:5173, phone API at :8000
#   Ctrl+C                    → stops both
#
# API keys: put GOOGLE_PLACES_API_KEY / FOURSQUARE_API_KEY in the project-root .env.
# Without keys the map still works; business phones just show "no listing found".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# ADJUSTABLE: ports. If 8000 is taken, change PHONE_PORT — the map is told the new URL below.
PHONE_PORT="${PHONE_PORT:-8000}"
MAP_PORT="${MAP_PORT:-5173}"

if [ ! -x "$ROOT/backend/.venv-phone/bin/uvicorn" ]; then
  echo "Creating phone-server environment (one time)…"
  python3 -m venv "$ROOT/backend/.venv-phone"
  "$ROOT/backend/.venv-phone/bin/pip3" install -q \
    "fastapi==0.115.0" "uvicorn==0.30.6" "httpx==0.27.2" "pydantic==2.9.2" "pydantic-settings==2.5.2"
fi

cd "$ROOT/backend"
.venv-phone/bin/uvicorn app.phone_app:app --host 127.0.0.1 --port "$PHONE_PORT" &
PHONE_PID=$!
trap 'kill $PHONE_PID 2>/dev/null' EXIT INT TERM

sleep 1
echo "Phone providers configured: $(curl -s "http://127.0.0.1:$PHONE_PORT/health" || echo 'server not responding')"

cd "$ROOT/frontend"
VITE_STATIC_MODE=true VITE_PHONE_API_URL="http://localhost:$PHONE_PORT/api/v1" \
  npx vite --port "$MAP_PORT" --open
