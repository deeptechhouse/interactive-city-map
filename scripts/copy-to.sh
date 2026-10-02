#!/usr/bin/env bash
# Copy this project to another of your Macs (e.g. the Mac mini) over Tailscale/SSH.
#
#   ./scripts/copy-to.sh <host> [remote-folder]
#   ./scripts/copy-to.sh macmini                         → ~/interactive-city-map on macmini
#   ./scripts/copy-to.sh macmini --with-keys             → also copy .env (your API keys)
#   ./scripts/copy-to.sh macmini --with-lookups          → also copy saved owner lookups
#
# Why not git clone: the 235 MB of map data (frontend/public/data/*.pmtiles) is not in git.
# This copies the working folder INCLUDING the data and the built map (frontend/dist-local),
# so the other Mac needs only Python — then run ./setup.sh there.
#
# Needs SSH to <host>: turn on System Settings → General → Sharing → Remote Login on it,
# or enable Tailscale SSH. Never deletes anything on the other Mac.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

HOST="${1:-}"
[ -n "$HOST" ] || { echo "usage: $0 <host> [remote-folder] [--with-keys] [--with-lookups]" >&2; exit 2; }
shift
DEST="interactive-city-map"
WITH_KEYS=0
WITH_LOOKUPS=0
for arg in "$@"; do
  case "$arg" in
    --with-keys) WITH_KEYS=1 ;;
    --with-lookups) WITH_LOOKUPS=1 ;;
    --*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) DEST="$arg" ;;
  esac
done

EXCLUDES=(
  --exclude 'node_modules/' --exclude '.venv*/' --exclude '__pycache__/'
  --exclude '.pytest_cache/' --exclude 'frontend/dist/' --exclude 'frontend/dist-static/'
  --exclude '.DS_Store'
)
# API keys and saved lookups (personal contact data) stay put unless asked for.
[ "$WITH_KEYS" = 1 ] || EXCLUDES+=(--exclude '.env')
[ "$WITH_LOOKUPS" = 1 ] || EXCLUDES+=(--exclude 'backend/data/')

if [ ! -f "$ROOT/frontend/dist-local/index.html" ]; then
  echo "Build the map first so the other Mac doesn't need Node:  (cd frontend && npm run build:local)" >&2
  exit 1
fi

echo "Copying to $HOST:~/$DEST …"
# -a keep permissions/times, -z compress, no --delete (never removes files over there).
rsync -az "${EXCLUDES[@]}" "$ROOT/" "$HOST:$DEST/"
echo
echo "Done. On $HOST run:"
echo "  cd ~/$DEST && ./setup.sh && ./scripts/macmini/install-autostart.sh"
