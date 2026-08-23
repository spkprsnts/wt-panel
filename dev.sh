#!/bin/bash
# Dev launcher for wt-panel — replaces the old dev.bat now that the panel is
# Linux/WSL-only (see README). Runs backend + frontend dev servers in this
# same terminal (background + foreground, not separate windows like
# dev.bat did on Windows), and stops both on Ctrl+C.
set -e
# Each backgrounded job gets its own process group (job control, normally
# off in a script) so cleanup can kill -TERM the *group*, not just the
# wrapper PID: `go run`/`npm run dev` both fork a grandchild (the actual
# compiled server binary / vite's node process) that a plain `kill $PID` on
# the wrapper doesn't reliably take down with it.
set -m
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$ROOT/frontend/node_modules" ]; then
	echo "Installing frontend dependencies..."
	(cd "$ROOT/frontend" && npm install)
fi

cleanup() {
	echo "Stopping..."
	[ -n "$BACKEND_PID" ] && kill -TERM -- "-$BACKEND_PID" 2>/dev/null
	[ -n "$FRONTEND_PID" ] && kill -TERM -- "-$FRONTEND_PID" 2>/dev/null
	exit 0
}
# HUP matters as much as INT/TERM here: closing the terminal tab/window
# while dev.sh is running sends SIGHUP, not SIGINT — without trapping it
# the shell dies immediately without running cleanup, leaving npm/vite
# (and go run's compiled binary) as orphaned processes still holding their
# ports. Confirmed via a real pty test (tmux) that plain Ctrl-C already
# worked; HUP was the untrapped gap.
trap cleanup EXIT INT TERM HUP

# --host (or -h): also bind the frontend dev server to 0.0.0.0 instead of
# just localhost, so it's reachable from another device on the LAN — e.g.
# testing against a phone's WireTurn app instead of just this machine's own
# browser. The backend needs no equivalent flag: WTP_LISTEN_ADDR defaults to
# ":8090", and an empty host in a Go listen address already means "every
# interface", not "localhost only" — only the frontend defaults narrower.
HOST_FLAG=""
for arg in "$@"; do
	case "$arg" in
	--host | -h)
		HOST_FLAG="--host"
		;;
	esac
done

echo "Starting backend on http://localhost:8090 (also reachable via this machine's LAN IP) ..."
(cd "$ROOT/backend" && go run ./cmd/server) &
BACKEND_PID=$!

if [ -n "$HOST_FLAG" ]; then
	echo "Starting frontend on http://0.0.0.0:5173 (reachable from the LAN) ..."
else
	echo "Starting frontend on http://localhost:5173 (pass --host to also expose it on the LAN) ..."
fi
(cd "$ROOT/frontend" && npm run dev -- $HOST_FLAG) &
FRONTEND_PID=$!

wait
