#!/bin/bash
# Prod-mode test launcher for wt-panel — companion to dev.sh, for testing
# the actual production code path instead of the day-to-day dev setup.
# dev.sh runs the Vite dev server and the Go API as two separate processes;
# this instead builds the frontend, embeds it into the Go binary exactly
# the way install.sh's build_from_source does (see
# backend/internal/webui/webui.go's go:embed), and runs that single
# self-contained binary — the same thing a real deployed panel runs.
# Same DB (backend/wtpanel.db by default — WTP_DB_PATH is unset here, same
# as dev.sh) and same port (8090), so switching between this and dev.sh
# day to day doesn't lose data or require different login steps.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="/tmp/wtp-prod-test"

if [ ! -d "$ROOT/frontend/node_modules" ]; then
	echo "Installing frontend dependencies..."
	(cd "$ROOT/frontend" && npm install)
fi

echo "Building frontend..."
(cd "$ROOT/frontend" && npm run build --silent)

echo "Embedding frontend into the backend build (backend/internal/webui/dist) ..."
rm -rf "$ROOT/backend/internal/webui/dist"
mkdir -p "$ROOT/backend/internal/webui/dist"
cp -r "$ROOT/frontend/dist/." "$ROOT/backend/internal/webui/dist/"
# .placeholder is checked into git (empty file, keeps `go build`/`go vet`
# working even with nothing built here yet) — recreate it so this script
# doesn't leave that tracked file showing as deleted in `git status`.
touch "$ROOT/backend/internal/webui/dist/.placeholder"

echo "Building backend..."
(cd "$ROOT/backend" && go build -o "$BIN" ./cmd/server)

echo "Starting wt-panel (production build) on http://localhost:8090 (also reachable via this machine's LAN IP) ..."
cd "$ROOT/backend"
exec "$BIN"
