#!/usr/bin/env bash
# Run ON THE MAC MINI: keep the map running at all times and reachable over Tailscale.
#
#   ./scripts/macmini/install-autostart.sh          install / update
#   ./scripts/macmini/install-autostart.sh --remove uninstall (stops it, removes the agent)
#
# 1. A launchd LaunchAgent starts ./run.sh at login and restarts it if it stops.
#    (Set the Mac mini to log in automatically so it comes back after a power cut:
#     System Settings → Users & Groups → Automatically log in as …)
# 2. `tailscale serve` publishes http://127.0.0.1:8000 to YOUR TAILNET ONLY, with HTTPS:
#      https://<mac-mini-name>.<your-tailnet>.ts.net
#    Not on the public internet and not on the home Wi-Fi — only devices signed in to
#    your Tailscale account can open it. That is the access control; no login page needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.citymap.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/citymap-server.log"
# ADJUSTABLE: must match what tailscale serve points at.
PORT=8000

TS="$(command -v tailscale || true)"
[ -n "$TS" ] || [ ! -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] || TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  [ -z "$TS" ] || "$TS" serve --https=443 off 2>/dev/null || true
  echo "Removed the City Map auto-start (and its Tailscale serve)."
  exit 0
fi

[ -x "$ROOT/backend/.venv-server/bin/uvicorn" ] || { echo "Run ./setup.sh first." >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/run.sh</string>
    <string>--no-open</string>
    <string>--strict-port</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PORT</key><string>$PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Auto-start installed. Log: $LOG"

for _ in $(seq 1 15); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/health" && echo || echo "Server not answering yet — check $LOG"

if [ -z "$TS" ]; then
  echo "Tailscale CLI not found. Install Tailscale, sign in, then run:  tailscale serve --bg $PORT"
  exit 0
fi
"$TS" serve --bg "$PORT"
echo
"$TS" serve status || true
echo "Open the address above on any device signed in to your Tailscale."
