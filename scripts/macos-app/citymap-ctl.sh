#!/bin/bash
# citymap-ctl.sh — start / check / stop the database-mode map for "City Map.app".
#
# PURPOSE  The app's AppleScript front end (CityMap.applescript) does the GUI: Dock icon,
#          dialogs and opening the browser. This script does the process work, so the
#          applet never blocks: `start` returns immediately and the applet polls `check`.
#          It is copied into the bundle (Contents/Resources) by build-app.sh, next to
#          project-root.txt, which holds the repo path the app was built from.
#
# COMMANDS (each prints ONE line that the applet parses)
#   start   → "ready <url>"    a City Map server is already answering — just open it
#             "starting <url>" launched ./run-db.sh in the background; poll `check`
#   check   → "ready <url>" | "starting <url>" | "failed <log path>"
#   stop    → "stopped" | "not-ours" — stops ONLY a server this app started (its own
#             pidfile); a ./run-db.sh you started in Terminal is left alone. Docker
#             containers keep running, same as Ctrl+C in ./run-db.sh.
#   log     → prints the log path
#   Exit status is non-zero, with the message on stderr, when the project is missing.
#
# FLOW     applet run → start → (idle loop) check … ready → open URL
#          applet quit → stop
#
# TRAP     Apps launched from Finder/Dock get PATH=/usr/bin:/bin:/usr/sbin:/sbin — no
#          docker, python3.12 or npm. run-db.sh would die with "command not found", so
#          PATH is rebuilt below (Intel Homebrew = /usr/local/bin, Apple silicon =
#          /opt/homebrew/bin, Docker Desktop's own bin as a fallback).
set -u

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cat "$HERE/project-root.txt" 2>/dev/null || true)"

# ADJUSTABLE: where the app keeps its pid/port files and the server log.
STATE_DIR="$HOME/Library/Application Support/CityMap"
LOG_DIR="$HOME/Library/Logs/CityMap"
LOG="$LOG_DIR/server.log"
PIDFILE="$STATE_DIR/server.pid"
PORTFILE="$STATE_DIR/server.port"
# ADJUSTABLE: first port tried — 8100 matches ./run-db.sh, so a server you started in
# Terminal is found and reused instead of starting a second one. CITYMAP_BASE_PORT
# overrides it (tests use it to run beside a live server).
BASE_PORT="${CITYMAP_BASE_PORT:-8100}"
# ADJUSTABLE: how many ports above BASE_PORT to scan for an existing map / a free port.
PORT_SPAN=20

mkdir -p "$STATE_DIR" "$LOG_DIR"

# Is a City Map database server answering on $1? /health alone is generic FastAPI, so
# also require /api/v1/cities — that keeps some other app on 8100 from being "reused".
# O(1) time, O(1) space — n = 2 local HTTP probes
is_map() {
  curl -sf -m 2 "http://127.0.0.1:$1/health" 2>/dev/null | grep -q '"ok"' &&
    curl -sf -m 4 -o /dev/null "http://127.0.0.1:$1/api/v1/cities" 2>/dev/null
}

# O(1) time, O(1) space — n = 1 lsof call
in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Is the process group this app started still alive?
# TRAP: a bare `kill -0 <pid>` is not enough. If the applet was force-quit or the Mac
# lost power, server.pid survives, and after a reboot that pid can belong to an
# unrelated app — `stop` would then SIGKILL its whole process group. So the pid only
# counts if it still leads its own group (we made it one) AND is still run-db.sh or the
# uvicorn it exec'd into. Anything else = stale: the files are deleted.
# O(1) time, O(1) space — n = 1 pid
ours_alive() {
  [ -s "$PIDFILE" ] || return 1
  local pid cmd
  pid="$(cat "$PIDFILE")"
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  if [ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" = "$pid" ] &&
    case "$cmd" in *"$ROOT/run-db.sh"* | *"uvicorn app.db_map_server"*) true ;; *) false ;; esac; then
    return 0
  fi
  rm -f "$PIDFILE" "$PORTFILE"
  return 1
}

# Port of a City Map already running anywhere in BASE_PORT…+PORT_SPAN (ours first).
# O(p) time, O(1) space — p = PORT_SPAN ports probed
find_running() {
  if [ -s "$PORTFILE" ] && is_map "$(cat "$PORTFILE")"; then cat "$PORTFILE"; return 0; fi
  local p=$BASE_PORT
  # O(p) time, O(1) space — p = PORT_SPAN ports
  while [ "$p" -le $((BASE_PORT + PORT_SPAN)) ]; do
    if in_use "$p" && is_map "$p"; then echo "$p"; return 0; fi
    p=$((p + 1))
  done
  return 1
}

# O(1) time, O(1) space — n = 1 project check
require_project() {
  if [ -z "$ROOT" ] || [ ! -x "$ROOT/run-db.sh" ]; then
    echo "City Map project not found at '${ROOT:-?}'. Rebuild the app from the project folder: scripts/macos-app/build-app.sh" >&2
    exit 3
  fi
}

# O(p) time, O(1) space — p = PORT_SPAN ports probed
cmd_start() {
  require_project
  local port
  if port=$(find_running); then echo "ready http://localhost:$port"; return; fi
  if ours_alive && [ -s "$PORTFILE" ]; then echo "starting http://localhost:$(cat "$PORTFILE")"; return; fi

  port=$BASE_PORT
  # O(p) time, O(1) space — p = busy ports skipped
  while in_use "$port"; do port=$((port + 1)); done
  echo "$port" >"$PORTFILE"
  printf '\n==== %s  City Map.app → ./run-db.sh --no-open on port %s ====\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$port" >>"$LOG"

  # setpgrp makes run-db.sh the leader of its own process group, so `stop` can end it
  # AND its children (docker wait loop, npm build, uvicorn) with one signal. macOS has
  # no `setsid` command; the system perl does the same job. nohup + all three fds
  # redirected = AppleScript's `do shell script` returns at once instead of waiting.
  PORT="$port" nohup /usr/bin/perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!"' \
    "$ROOT/run-db.sh" --no-open </dev/null >>"$LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$PIDFILE"
  # Wait for setpgrp to take effect — until then ours_alive would call the pid stale.
  # O(t) time, O(1) space — t = 0.1-second checks (≤ 20)
  for _ in $(seq 1 20); do [ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" = "$pid" ] && break; sleep 0.1; done
  echo "starting http://localhost:$port"
}

# O(p) time, O(1) space — p = PORT_SPAN ports probed
cmd_check() {
  local port
  # find_running before "still starting": run-db.sh re-scans for a free port itself, so if
  # ours lost a race for the port in server.port it is listening one or two ports higher.
  if port=$(find_running); then echo "ready http://localhost:$port"; return; fi
  if ours_alive; then echo "starting http://localhost:$(cat "$PORTFILE" 2>/dev/null || echo $BASE_PORT)"; return; fi
  echo "failed $LOG"
}

# O(t) time, O(1) space — t = 0.5-second waits for shutdown (≤ 20)
cmd_stop() {
  if ! ours_alive; then rm -f "$PIDFILE"; echo "not-ours"; return; fi
  local pid
  pid="$(cat "$PIDFILE")"
  kill -TERM -- "-$pid" 2>/dev/null
  # O(t) time, O(1) space — t = checks (≤ 20 → 10 s)
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
  rm -f "$PIDFILE" "$PORTFILE"
  echo "stopped"
}

case "${1:-}" in
  start) cmd_start ;;
  check) cmd_check ;;
  stop) cmd_stop ;;
  log) echo "$LOG" ;;
  *) echo "usage: $0 start|check|stop|log" >&2; exit 2 ;;
esac
