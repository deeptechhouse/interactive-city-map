#!/usr/bin/env bash
# Run the map in DATABASE mode — Chicago, Detroit and Dayton served from PostGIS.
#
#   ./run-db.sh              start on http://localhost:8100 (next free port if busy) and open it
#   ./run-db.sh --no-open    don't open a browser
#   ./run-db.sh --rebuild    rebuild the map (frontend/dist-db) first
#   PORT=8123 ./run-db.sh    choose the port
#
# What runs:
#   Docker  postgres (PostGIS, :5433)  martin (vector tiles, :3030)  minio (Sanborn sheets, :9000)
#           — all bound to 127.0.0.1 (docker-compose.yml)
#   Python  backend/app/db_map_server.py: the built map + full API + /tiles and /sanborn
#           proxies, so other devices (Tailscale) only ever talk to this one port.
#
# Static mode without Docker is still ./run.sh. Both can run at once (8000 vs 8100).
#
# First time on a machine: Docker Desktop, then this script creates backend/.venv-db and
# builds the map; load the cities once with
#   (cd backend && .venv-db/bin/python -m scripts.load_city_db --city detroit)
#   (cd backend && .venv-db/bin/python -m scripts.load_city_db --city dayton)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

OPEN=1
REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    --rebuild) REBUILD=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
say() { printf '\033[1m%s\033[0m\n' "$*"; }

# ---- Python env (Python 3.12: asyncpg 0.29 has no 3.14 wheels) ----------------------
if [ ! -x backend/.venv-db/bin/uvicorn ]; then
  PY="${PYTHON:-python3.12}"
  command -v "$PY" >/dev/null || { echo "Python 3.12 needed: brew install python@3.12" >&2; exit 1; }
  say "Creating backend/.venv-db"
  "$PY" -m venv backend/.venv-db
  backend/.venv-db/bin/pip3 install -q --upgrade pip
  backend/.venv-db/bin/pip3 install -q -r backend/requirements-db.txt
fi

# ---- Built map ------------------------------------------------------------------------
if [ "$REBUILD" = 1 ] || [ ! -f frontend/dist-db/index.html ]; then
  say "Building the database-mode map → frontend/dist-db"
  (cd frontend && npm run build:db)
fi

# ---- Docker: database, tiles, Sanborn images -----------------------------------------
if ! docker info >/dev/null 2>&1; then
  say "Starting Docker Desktop…"
  open -a Docker
  # O(t) time, O(1) space — t = 3-second checks (≤ 60)
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || { echo "Docker did not start." >&2; exit 1; }
fi
# The postgres volume was initialised with these credentials; the containers listen on
# 127.0.0.1 only. ADJUSTABLE via .env (POSTGRES_PASSWORD / MINIO_ROOT_PASSWORD) on a new
# machine — but an EXISTING volume keeps the password it was created with.
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-citymap}"
export MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
say "Starting postgres, martin, minio (Docker)"
docker compose up -d postgres martin minio >/dev/null
# O(t) time, O(1) space — t = 2-second checks (≤ 30)
for _ in $(seq 1 30); do docker exec citymap-postgres pg_isready -U citymap >/dev/null 2>&1 && break; sleep 2; done
(cd backend && .venv-db/bin/alembic upgrade head >/dev/null)
# Martin lists tables/functions only at start-up — restart it so new ones (parks,
# buildings_lod, …) are published after a migration.
docker restart citymap-martin >/dev/null

missing=$(docker exec citymap-postgres psql -U citymap -d citymap -Atc \
  "SELECT string_agg(s, ', ') FROM unnest(ARRAY['chicago','detroit','dayton']) s
   WHERE NOT EXISTS (SELECT 1 FROM buildings b JOIN cities c ON c.id = b.city_id WHERE c.slug = s)")
if [ -n "$missing" ]; then
  echo "No buildings loaded yet for: $missing — see the load_city_db commands at the top of this script." >&2
fi

# ---- Serve -----------------------------------------------------------------------------
# ADJUSTABLE: default port (8100, so static mode can keep 8000).
PORT="${PORT:-8100}"
in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
# O(p) time, O(1) space — p = busy ports skipped
while in_use "$PORT"; do PORT=$((PORT + 1)); done
URL="http://localhost:$PORT"
say "City map (database mode) → $URL   (Ctrl+C to stop; Docker keeps running)"
if [ "$OPEN" = 1 ]; then (sleep 3 && open "$URL") & fi
cd backend
exec .venv-db/bin/uvicorn app.db_map_server:app --host 127.0.0.1 --port "$PORT"
