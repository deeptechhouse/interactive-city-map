#!/usr/bin/env bash
# One-time setup on any Mac — no Docker, no database. Safe to re-run.
#
#   ./setup.sh            Python env for the map server + build the map (if Node is present)
#
# What it does:
#   1. backend/.venv-server  ← pinned packages from backend/requirements-server.txt
#   2. .env                  ← copied from .env.example if missing (add your API keys there)
#   3. frontend/dist-local   ← the built map. Needs Node 20+. On a machine WITHOUT Node
#                              (e.g. the Mac mini), copy a built folder over with
#                              scripts/copy-to.sh instead — the map server only needs Python.
# Then start it with ./run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---- 1. Python ---------------------------------------------------------------
PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3.10+ is required. Install it with:  brew install python@3.12" >&2
  exit 1
fi
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "Python 3.10+ is required (found $("$PY" --version)). Install: brew install python@3.12" >&2
  exit 1
fi
say "Python: $("$PY" --version) → backend/.venv-server"
[ -x backend/.venv-server/bin/python ] || "$PY" -m venv backend/.venv-server
backend/.venv-server/bin/pip3 install -q --upgrade pip
backend/.venv-server/bin/pip3 install -q -r backend/requirements-server.txt

# ---- 2. Settings ---------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  say ".env created from .env.example — add GOOGLE_PLACES_API_KEY, FOURSQUARE_API_KEY, TRACERFY_API_KEY"
else
  say ".env already present (left unchanged)"
fi

# ---- 3. Map data + build --------------------------------------------------------
if ! ls frontend/public/data/*.pmtiles >/dev/null 2>&1 && [ ! -d frontend/dist-local/data ]; then
  echo "Map data (frontend/public/data/*.pmtiles) is missing — it isn't stored in git." >&2
  echo "Copy the project from a computer that has it:  ./scripts/copy-to.sh <this-mac>" >&2
  exit 1
fi
if command -v node >/dev/null 2>&1 && [ -f frontend/package-lock.json ]; then
  say "Node $(node --version): building the map → frontend/dist-local"
  (
    cd frontend
    npm ci --no-audit --no-fund
    [ -d public/fonts ] || node scripts/fetch-fonts.mjs
    npm run build:local
  )
elif [ -f frontend/dist-local/index.html ]; then
  say "No Node here — using the already-built map in frontend/dist-local"
else
  echo "No Node and no built map. Either install Node (brew install node@20) or copy a" >&2
  echo "built project here with ./scripts/copy-to.sh from a computer that has one." >&2
  exit 1
fi

say "Done. Start the map with:  ./run.sh"
