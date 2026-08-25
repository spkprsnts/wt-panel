#!/bin/bash
# wt-panel installer/updater/uninstaller — mirrors 3x-ui's one-line-install
# shape (systemd unit, enable --now). A fresh install run from a real
# terminal asks up front which kernels to install (prompt_kernel_selection)
# and where SSL should point (prompt_ssl_target) — both answered before any
# actual work starts, so the rest of the run (binary fetch, kernel installs,
# acme.sh) proceeds unattended instead of stopping mid-way to wait on an
# answer. Safe to ask interactively even under the documented one-line
# install form (`bash -c "$(curl ...)"`): that form never consumes stdin,
# unlike `curl | bash`. Piped/non-interactive runs (no tty) skip both
# prompts and fall back to sensible silent defaults (install everything,
# auto-detect the public IP for SSL) — same for either question answered
# via an explicit flag already. The admin password and URI base path are
# always random-generated, never prompted for — printed in a summary box at
# the very end of the run (print_install_summary) rather than up front,
# since there's nothing sensible to default them to and nothing to ask.
#
# Gets the wt-panel binary itself from the newest GitHub Release
# (.github/workflows/release.yml + .goreleaser.yaml — auto-versioned from
# Conventional Commits) when one exists, same as the kernel installers
# already do for Turnable/FreeTurn/Xray-core. Falls back to building from
# source (needs this script run from inside a checked-out copy of the repo)
# only if no release is reachable yet, or --from-source was passed
# explicitly — see get_binary.
#
# Usage:
#   sudo ./install.sh [install] [--no-kernels] [--skip-kernel=NAME ...] [--ssl=DOMAIN-OR-IP] [--no-ssl] [--from-source]
#       fresh install, or update if already installed. On a fresh install
#       (only — an update never re-triggers this) also installs/builds every
#       kernel (Turnable/FreeTurn/Xray-core/webdav-tunnel from GitHub
#       Releases, olcRTC built from source at OLCRTC_REF, default "master"),
#       so a brand new box is immediately usable without a separate trip to
#       the "Kernels" page. With a real terminal attached and neither
#       --no-kernels nor --skip-kernel= given, prompt_kernel_selection asks
#       which ones interactively (Enter = all); piped/non-interactive runs
#       just install everything. --no-kernels skips all of that outright;
#       --skip-kernel=NAME (repeatable, NAME one of
#       turnable/freeturn/xray/webdav/olcrtc) skips just that one and also
#       answers the prompt non-interactively.
#       SSL is on by default. With no --ssl/--no-ssl flag at all and a real
#       terminal attached (true for the one-line curl install too — see
#       prompt_ssl_target), it asks interactively: auto-detect this host's
#       own public IP (detect_public_ip — same three endpoints the panel
#       itself uses), a domain, a manual IP, or skip. Piped/non-interactive
#       runs (no tty) skip the prompt and just auto-detect the IP.
#       --ssl=DOMAIN-OR-IP names a specific target non-interactively instead
#       (a domain gets a normal ~90-day Let's Encrypt cert, an IP a
#       short-lived 6-day one via Let's Encrypt's "shortlived" profile —
#       same fix 3x-ui's own IP-cert flow uses, see setup_ssl for why);
#       --no-ssl skips SSL setup entirely. Either way it's acme.sh under the
#       hood, wired into the panel's own HTTPS listener via its settings
#       API. A failure here (port 80 busy,
#       no public IP reachable, DNS not pointed yet) is never fatal to the
#       rest of the install — it just leaves the panel on plain HTTP with a
#       message explaining what to do manually. Fresh-install only, same as
#       kernel auto-install — needs the panel already up to push the cert
#       paths through. --from-source skips the GitHub Release lookup and
#       always builds locally (needs this script run from inside a
#       checked-out copy of the repo) — for testing an unreleased change.
#   sudo ./install.sh ssl [--ssl=DOMAIN-OR-IP]
#       (re-)run SSL setup against a panel that's already installed and
#       running — for setting it up later on a box installed with --no-ssl,
#       switching IP->domain once DNS is pointed, or retrying after a
#       transient failure. Same interactive prompt as above when no --ssl=
#       is given. Authenticates by trying the install-time admin
#       password/URI base path first and only prompts for them if that no
#       longer works (changed via the panel's own Settings page since
#       install) — see cmd_ssl.
#   sudo ./install.sh uninstall      stop+remove the service and binary, keep data
#   sudo ./install.sh uninstall --purge   also delete the data directory (DB, kernel binaries)
#   sudo ./install.sh menu (or just: wtp)
#       interactive management menu (URI path, admin password, SSL, restart,
#       logs, update, uninstall) — the same script also gets installed to
#       /usr/local/bin/wtp on every install/update (see install_wtp_command), so
#       `sudo wtp` works from anywhere afterward. Bare `wtp`/`install.sh`
#       with no arguments shows this menu too, but only once the panel is
#       already installed and a real terminal is attached — a fresh box (or
#       a piped/non-interactive run) still gets the install/update behavior
#       above, unchanged. Path/password/TLS-clear go through
#       `wt-panel setting` (see cmd/server/setting.go) directly against the
#       sqlite file with the service stopped — no running panel or API
#       needed, since this menu exists precisely for when the panel won't
#       come up at all. See cmd_menu.
set -euo pipefail

INSTALL_DIR="${WTP_INSTALL_DIR:-/usr/local/wt-panel}"
SERVICE_NAME="wt-panel"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DATA_DIR="${INSTALL_DIR}/data"
DB_PATH="${DATA_DIR}/wtpanel.db"
BIN_PATH="${INSTALL_DIR}/wt-panel"
LISTEN_PORT="${WTP_LISTEN_PORT:-8090}"
REPO="${WTP_REPO:-spkprsnts/wt-panel}"

# BASH_SOURCE[0] is unset when this script runs via `bash -c "$(curl ...)"`
# (the documented one-line install/uninstall/ssl form) rather than as a real
# file on disk. Falling back to $0 doesn't work either in that case: the
# one-liner passes subcommand args as `bash -c "$script" -- ssl`, which
# makes $0 literally "--" — and `dirname --` parses that as its own
# end-of-options marker with no operand left, erroring "missing operand"
# instead of returning a path. So this only ever calls dirname when
# BASH_SOURCE[0] is genuinely set (a real, on-disk invocation); otherwise it
# falls back to $PWD, which is all build_from_source's "is this a
# checked-out repo" check (the only consumer of SCRIPT_DIR) needs to
# correctly fail in exactly this piped-execution case.
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
	SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
	SCRIPT_DIR="$PWD"
fi

# Color helpers — every user-facing message in this script goes through one
# of these instead of a bare echo, so success/failure/hints/headers stay
# visually distinct even with a lot of kernel-install/acme.sh noise printed
# in between.
red() { echo -e "\033[0;31m$1\033[0m"; }
green() { echo -e "\033[0;32m$1\033[0m"; }
yellow() { echo -e "\033[0;33m$1\033[0m"; }
cyan() { echo -e "\033[0;36m$1\033[0m"; }
bold() { echo -e "\033[1m$1\033[0m"; }

# section marks the start of a distinct install phase (fetching the binary,
# installing kernels, SSL setup) — each of those can print dozens of lines
# of its own (apt-get, curl, acme.sh...), so this is what makes it obvious
# where one phase ended and the next began when scrolling back.
section() {
	echo
	cyan "▸ $1"
}

# banner prints the wt-panel ASCII logo — shown once at the very start of
# cmd_install (fresh install or update) and once at the top of the
# interactive menu session (not on every redraw of its loop).
banner() {
	cyan "$(cat <<'EOF'
	
                     █████████████████     
                     █████████████████     
                     █████████████████     
                     █████████████████     
                        ██████████████     
                       ███████████████     
                     █████████████████     
                   ███████████ ███████     
                 ███████████   ███████     
      █████    ███████████                 
      ██████████████████                   
     █████████████████                     
     ████████████████                      
         █████████                         
EOF
)"
	echo
}

require_root() {
	if [[ $EUID -ne 0 ]]; then
		red "Run as root: sudo $0 $*"
		exit 1
	fi
}

# random_hex N prints 2*N random hex characters (no external dependency
# beyond /dev/urandom + od, both present on any systemd Linux).
random_hex() {
	head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# apt_updated tracks whether apt-get update already ran this invocation, so
# a fresh box that's never run it even once (package names won't resolve at
# all until it has) only pays for it once, not before every apt-get call.
apt_updated=0
ensure_apt_updated() {
	if [[ $apt_updated -eq 0 ]]; then
		echo "apt-get update..."
		apt-get update -qq
		apt_updated=1
	fi
}

ensure_git() {
	command -v git >/dev/null 2>&1 && return
	echo "git not found — installing..."
	ensure_apt_updated
	apt-get install -y -qq git
}

# ensure_go makes sure a modern-enough Go toolchain is on PATH. Deliberately
# not apt's golang-go: it lags upstream by years on most distros' stable
# releases — nowhere near what this repo's go.mod requires — so a missing
# `go` gets the real tarball from go.dev instead, same reasoning as
# ensure_node below for the exact same class of problem with apt's nodejs.
ensure_go() {
	command -v go >/dev/null 2>&1 && return
	if [[ -x /usr/local/go/bin/go ]]; then
		export PATH="/usr/local/go/bin:$PATH"
		return
	fi
	echo "go not found — installing the official build from go.dev..."
	ensure_apt_updated
	apt-get install -y -qq curl
	local arch
	case "$(uname -m)" in
	x86_64) arch=amd64 ;;
	aarch64) arch=arm64 ;;
	*)
		red "Unknown architecture $(uname -m) — install Go manually from https://go.dev/dl/"
		exit 1
		;;
	esac
	local goversion
	goversion=$(curl -fsSL "https://go.dev/VERSION?m=text" | head -1)
	curl -fsSL "https://go.dev/dl/${goversion}.linux-${arch}.tar.gz" -o /tmp/wtp-go.tar.gz
	rm -rf /usr/local/go
	tar -C /usr/local -xzf /tmp/wtp-go.tar.gz
	rm -f /tmp/wtp-go.tar.gz
	ln -sf /usr/local/go/bin/go /usr/local/bin/go
	ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
	export PATH="/usr/local/go/bin:$PATH"
}

# ensure_node: apt's own nodejs (18.x on Ubuntu 24.04, confirmed while
# setting up dev for this project) can't run this frontend's Vite/Rolldown
# toolchain at all (missing node:util.styleText) — NodeSource's 22.x can.
ensure_node() {
	command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && return
	echo "node/npm not found (or too old) — installing Node.js 22.x via NodeSource..."
	ensure_apt_updated
	apt-get install -y -qq curl
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
	apt-get install -y -qq nodejs
}

# build_from_source needs SCRIPT_DIR to actually be a checked-out copy of
# the repo (frontend/ + backend/ next to this script) — true when run as
# ./install.sh from inside a git clone, false for a bare install.sh fetched
# on its own (e.g. curl | bash from the README, or as this same file bundled
# into a release archive). get_binary only ever falls back here after that
# check, or when --from-source was passed explicitly, so a standalone script
# with no release reachable fails with a clear message instead of a
# confusing "no such file or directory" from cd.
build_from_source() {
	if [[ ! -f "$SCRIPT_DIR/backend/go.mod" ]]; then
		red "Can't build from source: $SCRIPT_DIR isn't a repository checkout."
		red "Clone the repository (git clone https://github.com/${REPO}) and run install.sh from there, or wait for a release."
		exit 1
	fi

	ensure_git
	ensure_go
	ensure_node

	echo "Building the frontend..."
	(cd "$SCRIPT_DIR/frontend" && npm ci --silent && npm run build --silent)

	rm -rf "$SCRIPT_DIR/backend/internal/webui/dist"
	mkdir -p "$SCRIPT_DIR/backend/internal/webui/dist"
	cp -r "$SCRIPT_DIR/frontend/dist/." "$SCRIPT_DIR/backend/internal/webui/dist/"

	echo "Building the backend..."
	(cd "$SCRIPT_DIR/backend" && go build -o "${BIN_PATH}.new" ./cmd/server)
}

ensure_jq() {
	command -v jq >/dev/null 2>&1 && return
	ensure_apt_updated
	apt-get install -y -qq jq
}

# download_release fetches the newest GitHub Release's wt-panel binary for
# this host's architecture (linux/amd64 or linux/arm64 — the only two
# .goreleaser.yaml builds) straight into ${BIN_PATH}.new, matching
# build_from_source's own output contract so cmd_install doesn't care which
# one actually ran. Returns non-zero (never exits/aborts) on ANY failure —
# no releases published yet, unsupported arch, network hiccup, GitHub's
# unauthenticated rate limit — so get_binary can silently fall back to
# building from source instead of the whole install failing outright.
download_release() {
	local arch
	case "$(uname -m)" in
	x86_64) arch=amd64 ;;
	aarch64) arch=arm64 ;;
	*) return 1 ;;
	esac
	ensure_apt_updated
	apt-get install -y -qq curl >/dev/null 2>&1 || true
	ensure_jq

	echo "Checking releases for ${REPO}..."
	local release_json
	release_json=$(curl -fsSL --max-time 10 "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null) || return 1

	local tag version asset_url
	tag=$(echo "$release_json" | jq -r '.tag_name // empty' 2>/dev/null) || return 1
	[[ -z "$tag" ]] && return 1
	version="${tag#v}"
	asset_url=$(echo "$release_json" | jq -r --arg name "wt-panel-${version}-linux-${arch}.tar.gz" \
		'.assets[]? | select(.name == $name) | .browser_download_url' 2>/dev/null)
	if [[ -z "$asset_url" ]]; then
		red "Release ${tag} has no build for linux-${arch}."
		return 1
	fi

	echo "Downloading wt-panel ${tag} (linux-${arch})..."
	local tmp_tar tmp_dir
	tmp_tar=$(mktemp)
	tmp_dir=$(mktemp -d)
	if ! curl -fsSL --max-time 120 "$asset_url" -o "$tmp_tar"; then
		rm -rf "$tmp_tar" "$tmp_dir"
		return 1
	fi
	if ! tar -xzf "$tmp_tar" -C "$tmp_dir" wt-panel 2>/dev/null; then
		rm -rf "$tmp_tar" "$tmp_dir"
		return 1
	fi
	mv "$tmp_dir/wt-panel" "${BIN_PATH}.new"
	chmod +x "${BIN_PATH}.new"
	rm -rf "$tmp_tar" "$tmp_dir"
	green "Downloaded release ${tag}."
}

# get_binary is what cmd_install actually calls: prefer a real GitHub
# Release (download_release), falling back to a local build only when no
# release is reachable — see build_from_source's own guard for what happens
# if that fallback also isn't possible (a standalone script, not a repo
# checkout). from_source=1 (the --from-source flag) skips straight to the
# local build, e.g. to test an unreleased change.
get_binary() {
	local from_source="$1"
	if [[ "$from_source" -eq 1 ]]; then
		build_from_source
		return
	fi
	if download_release; then
		return
	fi
	echo "No release available — building from source..."
	build_from_source
}

# json_field EXTRACTS a top-level string/number field's value from a small
# JSON blob without depending on jq/python3 — deliberate, matching the same
# "fresh minimal system" bootstrapping philosophy as ensure_go/ensure_node
# above: a brand new box may have neither. Only handles the flat shapes the
# API responses below actually return (quoted strings or bare identifiers).
# download_release above needs real array traversal instead (picking one
# named asset out of several), so that one uses jq (ensure_jq) rather than
# straining this against a shape it was never meant for.
json_field() {
	local json="$1" field="$2"
	echo "$json" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" | head -1
}

# detect_panel_scheme figures out (once per run, cached in PANEL_SCHEME)
# whether the panel is currently answering its listen port as plain HTTP or
# HTTPS. Every internal call this script makes to 127.0.0.1 needs this: it
# used to hardcode http://, which works fine right after a fresh install
# but breaks the moment ANY earlier SSL setup (this run's own, or an
# already-configured one — e.g. switching from an IP cert to a domain one)
# makes the panel require TLS there — Go's net/http replies to a plain
# request hitting a TLS listener with a flat 400 "client sent an HTTP
# request to an HTTPS server", which is exactly what broke login on a real
# VPS mid-switch. Only caches a result once a real HTTP response actually
# comes back on one of the two schemes — a "000" (no response at all) from
# both just means the panel isn't listening yet, not "it's HTTP", so this
# is safe to call from wait_for_panel's retry loop before the panel is up.
# -k is always safe to add to these probes: 127.0.0.1 never matches the
# cert's own name/IP even when the cert itself is perfectly valid, and -k
# is simply ignored on a plain http:// URL.
PANEL_SCHEME=""
detect_panel_scheme() {
	[[ -n "$PANEL_SCHEME" ]] && return 0
	local code
	code=$(curl -k -s -o /dev/null -w '%{http_code}' --max-time 2 "https://127.0.0.1:${LISTEN_PORT}/" 2>/dev/null || true)
	if [[ -n "$code" && "$code" != "000" ]]; then
		PANEL_SCHEME="https"
		return 0
	fi
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${LISTEN_PORT}/" 2>/dev/null || true)
	if [[ -n "$code" && "$code" != "000" ]]; then
		PANEL_SCHEME="http"
		return 0
	fi
	return 1
}

# wait_for_panel polls the just-started panel until it answers HTTP requests
# at all (any status code counts — /api/login on GET is expected to 404/405,
# this is purely "is something listening yet", not an auth check).
wait_for_panel() {
	local base="$1" i=0 code
	while [[ $i -lt 30 ]]; do
		if detect_panel_scheme; then
			code=$(curl -k -s -o /dev/null -w '%{http_code}' --max-time 2 "${PANEL_SCHEME}://127.0.0.1:${LISTEN_PORT}${base}api/login" 2>/dev/null || true)
			[[ -n "$code" && "$code" != "000" ]] && return 0
		fi
		sleep 1
		i=$((i + 1))
	done
	return 1
}

# kernel_skipped NAME checks $skip_kernels (space-separated, populated by
# --skip-kernel=NAME) for NAME.
kernel_skipped() {
	local name="$1" k
	for k in $skip_kernels; do
		[[ "$k" == "$name" ]] && return 0
	done
	return 1
}

# prompt_kernel_selection only runs on a fresh, interactive install where
# neither --no-kernels nor --skip-kernel= was already passed — same "ask
# only when nobody already decided and someone's there to answer" rule
# prompt_ssl_target follows. Prints a space-separated skip-list on stdout
# (empty = install everything) via command substitution, so — same as
# prompt_ssl_target — every other message here has to go to stderr.
prompt_kernel_selection() {
	cyan "Which kernels should be installed?" >&2
	echo "  1. Turnable" >&2
	echo "  2. FreeTurn" >&2
	echo "  3. Xray-core" >&2
	echo "  4. WebDAV-tunnel" >&2
	echo "  5. olcRTC (built from source, can take a few minutes)" >&2
	echo >&2
	local choice=""
	read -r -p "Numbers separated by commas [Enter = all, 0 = none]: " choice || true
	choice="${choice// /}"
	[[ -z "$choice" ]] && return
	if [[ "$choice" == "0" ]]; then
		echo "turnable freeturn xray webdav olcrtc"
		return
	fi
	# Reject anything that isn't a comma-separated list of 1-5 (e.g. a typo
	# like "6" or stray letters) instead of silently treating every
	# unrecognized token as "not picked", which would otherwise skip every
	# kernel with no indication the input didn't parse.
	if [[ ! "$choice" =~ ^[1-5](,[1-5])*$ ]]; then
		red "Unrecognized selection \"${choice}\" — installing all kernels instead." >&2
		return
	fi
	local names=(turnable freeturn xray webdav olcrtc) skip="" i picked=",${choice},"
	for i in 1 2 3 4 5; do
		[[ "$picked" != *",${i},"* ]] && skip+=" ${names[$((i - 1))]}"
	done
	echo "$skip"
}

# install_kernels auto-installs/builds every kernel right after a fresh
# install, so a brand new box is immediately usable without a separate trip
# to the "Kernels" page. Skippable in whole (--no-kernels) or in part
# (--skip-kernel=NAME, repeatable). Only ever called for a fresh install —
# see cmd_install — so this never re-triggers a slow olcRTC rebuild on a
# routine update.
install_kernels() {
	local admin_password="$1" base="$2"

	if ! wait_for_panel "$base"; then
		red "The panel isn't responding — skipping kernel auto-install (do it manually on the \"Kernels\" page)."
		return 1
	fi

	local login_resp token
	login_resp=$(curl -fsS --max-time 10 -X POST "http://127.0.0.1:${LISTEN_PORT}${base}api/login" \
		-H 'Content-Type: application/json' \
		-d "{\"username\":\"admin\",\"password\":\"${admin_password}\"}") || {
		red "Failed to log in to the panel for kernel auto-install — do it manually on the \"Kernels\" page."
		return 1
	}
	token=$(json_field "$login_resp" token)
	if [[ -z "$token" ]]; then
		red "Logging in to the panel returned no token — skipping kernel auto-install."
		return 1
	fi

	local api="http://127.0.0.1:${LISTEN_PORT}${base}api"
	auth_curl() { curl -fsS --max-time 120 -H "Authorization: Bearer ${token}" "$@"; }

	if ! kernel_skipped turnable; then
		echo "Installing Turnable..."
		auth_curl -X POST "${api}/kernels/turnable/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  Turnable installed." || red "  Failed to install Turnable (see the \"Kernels\" page)."
	fi

	if ! kernel_skipped freeturn; then
		echo "Installing FreeTurn..."
		auth_curl -X POST "${api}/kernels/freeturn/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  FreeTurn installed." || red "  Failed to install FreeTurn (see the \"Kernels\" page)."
	fi

	if ! kernel_skipped xray; then
		echo "Installing Xray-core..."
		auth_curl -X POST "${api}/kernels/xray/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  Xray-core installed." || red "  Failed to install Xray-core (see the \"Kernels\" page)."
	fi

	if ! kernel_skipped webdav; then
		echo "Installing webdav-tunnel..."
		auth_curl -X POST "${api}/kernels/webdav/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  webdav-tunnel installed." || red "  Failed to install webdav-tunnel (see the \"Kernels\" page)."
	fi

	if ! kernel_skipped olcrtc; then
		echo "Building olcRTC from source (ref: ${OLCRTC_REF:-master})... this can take a few minutes."
		local build_resp job_id status i=0
		build_resp=$(auth_curl -X POST "${api}/kernels/olcrtc/build" -H 'Content-Type: application/json' \
			-d "{\"ref\":\"${OLCRTC_REF:-master}\"}") || {
			red "  Failed to start the olcRTC build (see the \"Kernels\" page)."
			build_resp=""
		}
		job_id=$(json_field "$build_resp" jobId)
		if [[ -n "$job_id" ]]; then
			status="running"
			while [[ "$status" == "running" && $i -lt 300 ]]; do
				sleep 3
				build_resp=$(auth_curl "${api}/kernels/olcrtc/build/${job_id}") || break
				status=$(json_field "$build_resp" status)
				i=$((i + 1))
			done
			case "$status" in
			success) green "  olcRTC built." ;;
			failed) red "  The olcRTC build failed (see the \"Kernels\" page for the log)." ;;
			*) red "  The olcRTC build didn't finish in the allotted time — check the \"Kernels\" page." ;;
			esac
		fi
	fi
}

# detect_public_ip queries a couple of plain-text "what's my IP" endpoints —
# same three, same order, as the panel's own detectPublicIP (backend/
# internal/db/db.go), used here so a fresh install can default --ssl to this
# host's own address without the operator having to look it up and pass it
# in themselves. Prints nothing and returns non-zero if every endpoint
# fails (no internet yet, all three coincidentally down, IPv6-only host).
detect_public_ip() {
	local ip url
	for url in "https://api.ipify.org" "https://ifconfig.me" "https://icanhazip.com"; do
		ip=$(curl -fsSL --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]')
		if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
			echo "$ip"
			return 0
		fi
	done
	return 1
}

# ensure_acme_sh installs acme.sh (root's own copy, ~/.acme.sh) — the same
# ACME client 3x-ui's own SSL menu is built on. Idempotent: a re-run just
# finds it already there. No account email needed at install time: every
# issuance path below (domain or IP) goes through Let's Encrypt, which
# doesn't require one — unlike ZeroSSL, which this used to also support for
# IP certs via External Account Binding (EAB) before that was ripped out
# (see setup_ssl) for being unreliable in practice.
ensure_acme_sh() {
	if [[ ! -x ~/.acme.sh/acme.sh ]]; then
		echo "acme.sh not found — installing..."
		ensure_apt_updated
		apt-get install -y -qq curl socat cron
		curl -fsSL https://get.acme.sh | sh >/dev/null
	fi
	_scrub_bad_acme_account_email
}

# _scrub_bad_acme_account_email drops any leftover email a version of this
# script from before this fix saved — back when ensure_acme_sh installed
# acme.sh with email="admin@$(hostname -f)", which on a VPS with no
# configured FQDN just resolves to a bare hostname with no dot (e.g.
# "admin@myvps"). Let's Encrypt's account registration validates the
# contact email's domain has a dot and rejects the ENTIRE registration
# outright if it doesn't ("contact email has invalid domain: Domain name
# needs at least one dot") — seen on a real VPS. Two places need clearing,
# not one: acme.sh's _getAccountEmail() checks the per-CA ca.conf's
# CA_EMAIL FIRST and only falls back to the global account.conf's
# ACCOUNT_EMAIL after — and _regAccount saves whatever _getAccountEmail()
# returned into that per-CA ca.conf right before attempting registration,
# regardless of whether the registration itself then succeeds or fails. So
# the very first (failed) attempt against a given CA already re-poisons its
# own ca.conf even after account.conf's copy is clean, which is exactly why
# clearing only account.conf didn't fix this the first time around. Neither
# Let's Encrypt nor this script's own flow needs a contact email at all
# (see setup_ssl), so unconditionally dropping every copy — not replacing
# them with a better one — is the fix.
_scrub_bad_acme_account_email() {
	local conf=~/.acme.sh/account.conf
	[[ -f "$conf" ]] && sed -i '/^ACCOUNT_EMAIL=/d' "$conf"
	find ~/.acme.sh/ca -name ca.conf -exec sed -i '/^CA_EMAIL=/d' {} + 2>/dev/null || true
}

# setup_ssl TARGET issues a real TLS cert for TARGET — a domain, a normal
# ~90-day Let's Encrypt cert, or a bare IP address, a short-lived (6-day,
# auto-renewing) Let's Encrypt cert via its "shortlived" certificate
# profile. Both go through the same CA now: this used to route IP targets
# through ZeroSSL instead (Let's Encrypt had no IP-certificate program at
# all until this profile launched), authenticating via External Account
# Binding (EAB) — every variation of that was tried here (--accountemail,
# an explicit --register-account, wiping cached CA state, passing
# --eab-kid/--eab-hmac-key straight on --issue) and every one of them still
# hit ZeroSSL's own "Cannot resolve _eab_kid" on a real VPS. 3x-ui's own IP
# cert flow (x-ui.sh's ssl_cert_issue_standalone_ip) already solved this by
# just using Let's Encrypt's shortlived profile instead of ZeroSSL/EAB at
# all — same fix here. Prints the two file paths on success. Uses acme.sh's
# standalone mode, so port 80 must be free for the few seconds the HTTP-01
# challenge takes. --reloadcmd restarts the panel automatically on every
# renewal (acme.sh installs its own cron job for that; a 6-day cert simply
# renews far more often than a normal 90-day one — --days 6 tells acme.sh
# to do so right before each one expires), not just this first issuance.
setup_ssl() {
	local target="$1"
	ensure_acme_sh

	mkdir -p "${DATA_DIR}/ssl"
	local cert_file="${DATA_DIR}/ssl/${target}.crt"
	local key_file="${DATA_DIR}/ssl/${target}.key"

	# Every caller invokes this as `ssl_files=$(setup_ssl "$target")`,
	# meaning its stdout IS its return value — the final printf below, and
	# nothing else. Every status/error message here, and the acme.sh
	# commands' own (quite verbose) stdout, must go to stderr instead, or
	# they'd get captured as part of that return value: seen for real on a
	# VPS, where the "Issuing..." line below ended up saved into the
	# panel's own tlsCertFile setting, which then couldn't be opened as a
	# file at all ("no such file or directory") and crash-looped the
	# service on every restart.
	local issue_args=(--issue -d "$target" --standalone --force --server letsencrypt)
	if [[ "$target" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		echo "Issuing a short-lived (6-day, auto-renewing) TLS certificate for IP ${target} via Let's Encrypt..." >&2
		issue_args+=(--certificate-profile shortlived --days 6)
	else
		echo "Issuing a TLS certificate for domain ${target} via Let's Encrypt..." >&2
	fi

	if ! ~/.acme.sh/acme.sh "${issue_args[@]}" >&2; then
		red "Failed to issue a certificate for ${target} — make sure port 80 is free and ${target} actually points to this server. Set up SSL manually later on the \"Settings\" page." >&2
		return 1
	fi

	if ! ~/.acme.sh/acme.sh --install-cert -d "$target" \
		--key-file "$key_file" \
		--fullchain-file "$cert_file" \
		--reloadcmd "systemctl restart ${SERVICE_NAME} 2>/dev/null || true" >&2; then
		red "The certificate for ${target} was issued, but installing it into ${DATA_DIR}/ssl failed — set up SSL manually on the \"Settings\" page." >&2
		return 1
	fi

	printf '%s\n%s\n' "$cert_file" "$key_file"
}

# apply_ssl_settings pushes the issued cert's paths (and, for a domain, the
# hostname) into the panel's own PanelSettings via its settings API — same
# API the Settings page's "Panel network" card uses — then restarts the
# service so main.go's ListenAndServeTLS branch picks them up (it only reads
# this row once at startup, see handlers_panel_settings.go). GETs the
# current settings first and only overwrites TLS/domain fields: the PUT
# endpoint replaces the whole row, so blindly sending zero values for
# ListenIP/ListenPort/BasePath would reset those to their unset defaults.
apply_ssl_settings() {
	local target="$1" cert_file="$2" key_file="$3" base="$4" admin_password="$5"

	# setup_ssl's own --install-cert already fired --reloadcmd (a
	# "systemctl restart wt-panel") the moment the cert was issued, so the
	# panel can be mid-restart right here — logging in immediately can hit
	# "Couldn't connect to server" purely from that timing, not a real
	# failure (seen on a real VPS on the very first SSL setup that actually
	# got this far, since every earlier attempt died inside setup_ssl
	# itself and never reached this race at all).
	wait_for_panel "$base" || true

	local login_resp token
	login_resp=$(curl -k -fsS --max-time 10 -X POST "${PANEL_SCHEME:-http}://127.0.0.1:${LISTEN_PORT}${base}api/login" \
		-H 'Content-Type: application/json' \
		-d "{\"username\":\"admin\",\"password\":\"${admin_password}\"}") || {
		red "Failed to log in to the panel to apply the SSL settings. The certificate was already issued — set the paths manually on the \"Settings\" page: TLS certificate: ${cert_file}, TLS key: ${key_file}"
		return 1
	}
	token=$(json_field "$login_resp" token)
	if [[ -z "$token" ]]; then
		red "Logging in to the panel returned no token — failed to apply the SSL settings. The certificate was already issued — set the paths manually on the \"Settings\" page: TLS certificate: ${cert_file}, TLS key: ${key_file}"
		return 1
	fi

	local current
	current=$(curl -k -fsS --max-time 10 -H "Authorization: Bearer ${token}" \
		"${PANEL_SCHEME:-http}://127.0.0.1:${LISTEN_PORT}${base}api/settings/panel") || {
		red "Failed to read the panel's current settings — failed to apply the SSL settings. The certificate was already issued — set the paths manually on the \"Settings\" page: TLS certificate: ${cert_file}, TLS key: ${key_file}"
		return 1
	}
	local listen_ip listen_port base_path public_ip
	listen_ip=$(json_field "$current" ListenIP)
	listen_port=$(json_field "$current" ListenPort)
	base_path=$(json_field "$current" BasePath)
	public_ip=$(json_field "$current" PublicIP)
	[[ -z "$listen_port" ]] && listen_port=0
	local listen_domain=""
	[[ ! "$target" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && listen_domain="$target"

	curl -k -fsS --max-time 10 -X PUT "${PANEL_SCHEME:-http}://127.0.0.1:${LISTEN_PORT}${base}api/settings/panel" \
		-H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
		-d "{\"listenIp\":\"${listen_ip}\",\"listenDomain\":\"${listen_domain}\",\"listenPort\":${listen_port},\"basePath\":\"${base_path}\",\"tlsCertFile\":\"${cert_file}\",\"tlsKeyFile\":\"${key_file}\",\"publicIp\":\"${public_ip}\"}" \
		>/dev/null || {
		red "Failed to save the panel's SSL settings. The certificate was already issued — set the paths manually on the \"Settings\" page: TLS certificate: ${cert_file}, TLS key: ${key_file}"
		return 1
	}

	systemctl restart "$SERVICE_NAME"
	green "SSL configured — the panel is now on https://${target}:${LISTEN_PORT}${base}"
	if [[ -z "$listen_domain" ]]; then
		# Let's Encrypt's short-lived IP-certificate profile (see setup_ssl)
		# chains through its own new root (ISRG Root YE, not the
		# universally-trusted ISRG Root X1 regular domain certs use) —
		# confirmed for real against a live VPS: openssl validated the
		# chain fine, but Chrome on a normal desktop still showed "Not
		# secure", because that root hadn't reached its OS trust store
		# yet. The certificate itself is genuinely valid; this is
		# Let's Encrypt's rollout catching up, not a setup problem — so
		# it's worth flagging here instead of leaving the operator to
		# wonder whether the install did something wrong.
		yellow "Note: a bare-IP certificate uses Let's Encrypt's new root (ISRG Root YE) for their IP-certificate pilot program. It hasn't been added to every OS/browser trust store yet, so the browser may show \"Not secure\" even when the certificate is valid. If this matters right now, use a domain instead: sudo ./install.sh ssl --ssl=DOMAIN."
	fi
	return 0
}

# issue_and_apply_ssl is the setup_ssl + apply_ssl_settings pair cmd_install
# (fresh installs) and cmd_ssl (an already-installed panel, run later) both
# need — kept as one function so a change to that sequence doesn't have to
# be made twice. Returns apply_ssl_settings' own exit code (0 only on a
# genuinely applied cert) so cmd_install can tell whether to report the new
# https:// URL in its final summary or fall back to the plain http:// one.
issue_and_apply_ssl() {
	local target="$1" base="$2" admin_password="$3"
	local ssl_files
	if ssl_files=$(setup_ssl "$target"); then
		apply_ssl_settings "$target" "$(echo "$ssl_files" | sed -n 1p)" "$(echo "$ssl_files" | sed -n 2p)" \
			"$base" "$admin_password"
	fi
}

# current_base_path_hint reads the URI base path this install was seeded
# with (Environment=WTP_INITIAL_BASE_PATH= in the unit file) to use as a
# prompt default in cmd_ssl — only a hint: WTP_INITIAL_BASE_PATH is a
# one-time seed (see install_service_unit), so if the operator changed the
# base path since via the panel's own Settings page, this will be stale and
# they'll need to type the current one instead of accepting the default.
current_base_path_hint() {
	local hint
	hint=$(sed -n 's/^Environment=WTP_INITIAL_BASE_PATH=//p' "$SERVICE_FILE" 2>/dev/null)
	echo "${hint:-/}"
}

# current_admin_password_hint reads the admin password this install was
# seeded with (Environment=WTP_ADMIN_PASSWORD= in the unit file) — same
# one-time-seed caveat as current_base_path_hint above: stale the moment
# the operator changes it via the panel itself. cmd_ssl only ever uses this
# to PROBE (see probe_panel_login) whether it still works before resorting
# to a prompt — never assumed correct outright, since a plaintext copy of
# the current password can't be recovered any other way (the panel only
# stores a hash of it).
current_admin_password_hint() {
	sed -n 's/^Environment=WTP_ADMIN_PASSWORD=//p' "$SERVICE_FILE" 2>/dev/null
}

# current_jwt_secret_hint reads the JWT signing secret this install already
# has seeded (Environment=WTP_JWT_SECRET= in the unit file) — unlike the two
# hints above, this one isn't a "best guess, may be stale" convenience: the
# backend has nowhere else to get this value from (config.getEnv falls back
# to the hardcoded, publicly-known "dev-insecure-secret-change-me" default
# the instant it's unset — see internal/config/config.go), and there's no
# admin_password/base_path-style DB row to fall back on either, since
# nothing ever persists it there. So install_service_unit must always carry
# whatever secret is already running forward into every rewrite of the unit
# file, fresh install or update alike, or every update would silently drop
# back to that public default and invalidate every session in the process.
current_jwt_secret_hint() {
	sed -n 's/^Environment=WTP_JWT_SECRET=//p' "$SERVICE_FILE" 2>/dev/null
}

# probe_panel_login checks whether base+password actually authenticate,
# printing nothing either way — cmd_ssl uses it to try the install-time
# seed values first (see the two hints above) before bothering the operator
# with a prompt. A failed probe is the expected, ordinary case whenever the
# password or base path changed since install, not an error worth
# surfacing here (a real problem still gets a clear message later, when
# apply_ssl_settings does its own login with whatever was finally used).
probe_panel_login() {
	local base="$1" password="$2"
	detect_panel_scheme || return 1
	local resp token
	resp=$(curl -k -fsS --max-time 10 -X POST "${PANEL_SCHEME}://127.0.0.1:${LISTEN_PORT}${base}api/login" \
		-H 'Content-Type: application/json' \
		-d "{\"username\":\"admin\",\"password\":\"${password}\"}" 2>/dev/null) || return 1
	token=$(json_field "$resp" token)
	[[ -n "$token" ]]
}

install_service_unit() {
	local admin_password="$1" base_path="$2" jwt_secret="$3"
	local extra_env=""
	[[ -n "$admin_password" ]] && extra_env+=$'\n'"Environment=WTP_ADMIN_PASSWORD=${admin_password}"
	[[ -n "$base_path" ]] && extra_env+=$'\n'"Environment=WTP_INITIAL_BASE_PATH=${base_path}"
	[[ -n "$jwt_secret" ]] && extra_env+=$'\n'"Environment=WTP_JWT_SECRET=${jwt_secret}"

	cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=wt-panel
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${BIN_PATH}
Environment=WTP_DATA_DIR=${DATA_DIR}
Environment=WTP_DB_PATH=${DB_PATH}
Environment=WTP_LISTEN_ADDR=:${LISTEN_PORT}${extra_env}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
	systemctl daemon-reload
}

# prompt_ssl_target only runs when neither --ssl= nor --no-ssl was passed AND
# stdin is a real terminal (cmd_install's `-t 0` check) — piped/automated
# installs (CI, `</dev/null`) never see this and keep the old silent
# auto-detect-IP default. Safe to prompt even under the one-line
# `sudo bash -c "$(curl ...)"` install: unlike `curl | bash`, that form never
# feeds the script itself through stdin, so stdin is still the operator's
# terminal here. Prints the chosen target on stdout (empty = skip) via
# command substitution, so every other message in here must go to stderr —
# otherwise it would end up captured as part of the "target" instead of
# shown to the operator.
prompt_ssl_target() {
	echo >&2
	cyan "SSL setup:" >&2
	echo "  1. Auto-detect this server's IP — Let's Encrypt, short-lived (default)" >&2
	echo "  2. Enter a domain — Let's Encrypt" >&2
	echo "  3. Enter an IP manually — Let's Encrypt, short-lived" >&2
	echo "  4. Skip" >&2
	echo >&2
	local choice="" target=""
	read -r -p "Choice [1-4, Enter=1]: " choice || true
	case "$choice" in
	2)
		read -r -p "Domain: " target || true
		;;
	3)
		read -r -p "IP: " target || true
		;;
	4)
		target=""
		;;
	*)
		echo "Detecting the public IP..." >&2
		target=$(detect_public_ip) || true
		if [[ -z "$target" ]]; then
			red "Failed to detect the public IP — skipping SSL. Set it up manually: sudo ./install.sh --ssl=IP-OR-DOMAIN, or on the \"Settings\" page." >&2
		fi
		;;
	esac
	echo "$target"
}

WTP_COMMAND_PATH="/usr/local/bin/wtp"

# install_wtp_command copies this script to WTP_COMMAND_PATH so `sudo wtp`
# works from anywhere — the same script, just under a permanent, memorable
# name (mirrors 3x-ui's own `x-ui` command; see cmd_menu). Called
# unconditionally near the bottom of this file (not just from cmd_install)
# so wtp stays in sync with whatever's actually running on EVERY
# invocation, menu included — see that call site's own comment for why
# that matters. Prefers a real local copy (SCRIPT_DIR genuinely is a
# checked-out repo — --from-source testing) over re-downloading, so a
# locally-modified install.sh doesn't get silently clobbered by the
# published one — but "genuinely" has to be checked for real
# (backend/go.mod next to it, same test build_from_source already uses),
# not just "a file named install.sh happens to exist there": SCRIPT_DIR
# falls back to $PWD for the piped one-liner (see its own comment above),
# so an unrelated leftover install.sh sitting in whatever directory the
# operator happened to be in — e.g. from testing the old two-command
# curl -o install.sh / bash install.sh form before it became this
# one-liner — would otherwise get silently copied over wtp instead of a
# fresh download.
install_wtp_command() {
	# Writes to a temp file and mv's it into place rather than writing
	# WTP_COMMAND_PATH directly — when this runs as part of `sudo wtp`
	# itself, that path IS the very script currently executing. cp/curl -o
	# both truncate-and-rewrite the destination's existing inode in place,
	# which can corrupt bash's own read of the script mid-execution (seen
	# for real: a `sudo wtp` run that silently did nothing at all). mv is an
	# atomic rename — the running process keeps reading the OLD inode's
	# content just fine (same reasoning as updatePanel's own binary swap,
	# see handlers_panel_settings.go), and only the NEXT invocation sees the
	# new file.
	local tmp
	# mktemp in WTP_COMMAND_PATH's own directory, not the default /tmp:
	# mv is only atomic when source and destination share a filesystem, and
	# /tmp is a separate tmpfs mount from /usr/local/bin on plenty of hosts
	# (RHEL/Fedora-family in particular) — across that boundary mv silently
	# falls back to a non-atomic copy-then-unlink, which reopens exactly the
	# mid-read corruption this whole temp-file dance exists to avoid.
	tmp=$(mktemp "$(dirname "$WTP_COMMAND_PATH")/.wtp.XXXXXX") || return 1
	if [[ -f "$SCRIPT_DIR/install.sh" && -f "$SCRIPT_DIR/backend/go.mod" ]]; then
		cp "$SCRIPT_DIR/install.sh" "$tmp"
	elif ! curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/install.sh" -o "$tmp"; then
		rm -f "$tmp"
		return 1
	fi
	chmod +x "$tmp"
	mv "$tmp" "$WTP_COMMAND_PATH"
}

# print_install_summary is the LAST thing a fresh install prints, on
# purpose: kernel installs and acme.sh's own output can run to dozens of
# lines, and printing the credentials before all that just meant they'd
# already scrolled off-screen by the time the operator could copy them.
# panel_url reflects whatever's actually true by the time this runs (still
# http://, or https:// if SSL succeeded) rather than the initial guess.
print_install_summary() {
	local admin_password="$1" base_path="$2" panel_url="$3"
	echo
	cyan "════════════════════════════════════════════════════════════"
	bold "  wt-panel is installed and running"
	cyan "════════════════════════════════════════════════════════════"
	echo -e "  Login:    $(bold admin)"
	echo -e "  Password: $(bold "$admin_password")"
	echo -e "  URI path: $(bold "$base_path")"
	echo -e "  Panel:    $(bold "$panel_url")"
	cyan "════════════════════════════════════════════════════════════"
	echo "These values are also saved in ${SERVICE_FILE} — view them again with: systemctl cat ${SERVICE_NAME}"
	echo "Manage the panel (path, password, SSL, logs, update) with: sudo wtp"
}

cmd_install() {
	require_root
	banner

	local no_kernels=0 skip_kernels="" kernels_explicit=0 ssl_target="" ssl_explicit=0 no_ssl=0 from_source=0
	local arg
	for arg in "$@"; do
		case "$arg" in
		--no-kernels)
			no_kernels=1
			kernels_explicit=1
			;;
		--skip-kernel=*)
			skip_kernels="${skip_kernels} ${arg#--skip-kernel=}"
			kernels_explicit=1
			;;
		--ssl=*)
			ssl_target="${arg#--ssl=}"
			ssl_explicit=1
			;;
		--no-ssl) no_ssl=1 ;;
		--from-source) from_source=1 ;;
		*)
			red "Unknown flag: $arg"
			exit 1
			;;
		esac
	done

	mkdir -p "$INSTALL_DIR" "$DATA_DIR"

	local fresh=1
	[[ -f "$DB_PATH" ]] && fresh=0

	# Ask everything up front on a fresh, interactive install — so the rest
	# of the run (binary fetch, kernel installs, acme.sh) proceeds
	# unattended instead of stopping mid-way to wait on an answer. Piped/
	# non-interactive runs and updates never hit this at all; explicit flags
	# for either question skip asking that one.
	if [[ $fresh -eq 1 && -t 0 ]]; then
		if [[ $kernels_explicit -eq 0 ]]; then
			skip_kernels=$(prompt_kernel_selection)
			# All five picked "none" — skip install_kernels' whole
			# login/wait-for-panel dance instead of running it just to
			# find every single kernel individually skipped.
			local skipped_count=0 k
			for k in $skip_kernels; do skipped_count=$((skipped_count + 1)); done
			[[ $skipped_count -ge 5 ]] && no_kernels=1
		fi
		if [[ $no_ssl -eq 0 && $ssl_explicit -eq 0 ]]; then
			ssl_target=$(prompt_ssl_target)
			ssl_explicit=1
		fi
	fi

	section "Fetching wt-panel"
	get_binary "$from_source"

	systemctl stop "$SERVICE_NAME" 2>/dev/null || true
	mv "${BIN_PATH}.new" "$BIN_PATH"
	chmod +x "$BIN_PATH"

	local admin_password="" base_path="" jwt_secret=""
	if [[ $fresh -eq 1 ]]; then
		# 9 bytes -> 18 hex chars for the password, 4 -> 8 for the path
		# segment — both env-var-seeded once, on this very first boot (see
		# db.seedAdmin/seedPanelSettings); safe to leave in the unit file
		# permanently since they're no-ops once the rows exist.
		admin_password=$(random_hex 9)
		base_path="/$(random_hex 4)/"
		# 32 bytes -> 64 hex chars for the JWT signing secret. Unlike the
		# two above, this one is NOT a one-time DB seed — every process
		# startup reads it straight from this env var (see
		# current_jwt_secret_hint's own comment) — so it's generated once
		# here and then carried forward unchanged on every future update
		# below, never regenerated.
		jwt_secret=$(random_hex 32)
	else
		jwt_secret=$(current_jwt_secret_hint)
		# An install from before this env var existed has nothing to carry
		# forward — seed it now rather than leaving the service running on
		# the public "dev-insecure-secret-change-me" default indefinitely.
		[[ -z "$jwt_secret" ]] && jwt_secret=$(random_hex 32)
	fi

	install_service_unit "$admin_password" "$base_path" "$jwt_secret"
	systemctl enable --now "$SERVICE_NAME"

	sleep 1
	if [[ $fresh -eq 1 ]]; then
		green "Installed and started."
		local panel_url="http://<SERVER-IP>:${LISTEN_PORT}${base_path}"

		if [[ $no_kernels -eq 1 ]]; then
			yellow "Kernel auto-install skipped."
		else
			section "Installing kernels"
			# `|| true`: install_kernels returns 1 on a login/panel failure, and
			# under this script's `set -e` an unguarded non-zero return here
			# would abort the rest of the install (SSL setup, final summary)
			# instead of just leaving kernels for the operator to install
			# manually later, which is the whole point of it being best-effort.
			install_kernels "$admin_password" "$base_path" || true
		fi

		if [[ $no_ssl -eq 1 ]]; then
			yellow "SSL skipped (--no-ssl)."
		else
			if [[ $ssl_explicit -eq 0 ]]; then
				# Non-interactive run (no tty) and no --ssl= given — keep
				# the old silent auto-detect-IP default; nobody's there to
				# answer prompt_ssl_target.
				echo "Detecting the public IP for SSL (defaults to a short-lived Let's Encrypt certificate on the IP; use your own domain: --ssl=DOMAIN, disable: --no-ssl)..."
				ssl_target=$(detect_public_ip) || true
				if [[ -z "$ssl_target" ]]; then
					red "Failed to detect the public IP — skipping SSL. Set it up manually: sudo ./install.sh --ssl=IP-OR-DOMAIN, or on the \"Settings\" page."
				fi
			fi
			if [[ -n "$ssl_target" ]]; then
				section "SSL setup"
				if issue_and_apply_ssl "$ssl_target" "$base_path" "$admin_password"; then
					panel_url="https://${ssl_target}:${LISTEN_PORT}${base_path}"
				fi
			fi
		fi

		print_install_summary "$admin_password" "$base_path" "$panel_url"
	else
		green "Updated and restarted (data in ${DATA_DIR} preserved)."
	fi
}

cmd_uninstall() {
	require_root
	local purge=0
	[[ "${1:-}" == "--purge" ]] && purge=1

	systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
	rm -f "$SERVICE_FILE"
	systemctl daemon-reload

	if [[ $purge -eq 1 ]]; then
		rm -rf "$INSTALL_DIR"
		green "The panel and all data (${INSTALL_DIR}) have been removed."
	else
		rm -f "$BIN_PATH"
		green "The panel has been removed, data preserved in ${DATA_DIR}."
		echo "To remove the data too: $0 uninstall --purge"
	fi
}

# cmd_ssl (re-)runs SSL setup against a panel that's already installed and
# running — cmd_install's own SSL step only ever fires on a fresh install
# (see its own doc comment), so this is how to add/replace a cert later:
# switching from IP to a domain once DNS is pointed, retrying after a
# transient acme.sh failure, or setting SSL up for the first time on a box
# that was installed with --no-ssl. Needs the current admin password and
# URI base path to authenticate against the panel's own settings API (see
# issue_and_apply_ssl/apply_ssl_settings) — there's no other way in, since
# the panel only stores a password hash and the base path is deliberately
# unguessable without logging in first. Tries the install-time seed values
# (WTP_ADMIN_PASSWORD/WTP_INITIAL_BASE_PATH in the unit file) via
# probe_panel_login first so the common case — nothing changed since
# install — needs no prompt at all; only asks when that probe fails
# (password or base path actually changed via the panel's own Settings
# page since).
cmd_ssl() {
	require_root
	if [[ ! -x "$BIN_PATH" ]]; then
		red "The panel isn't installed — first run: sudo ./install.sh"
		exit 1
	fi
	if ! systemctl is-active --quiet "$SERVICE_NAME"; then
		red "The ${SERVICE_NAME} service isn't running — sudo systemctl start ${SERVICE_NAME}"
		exit 1
	fi

	local ssl_target="" ssl_explicit=0
	local arg
	for arg in "$@"; do
		case "$arg" in
		--ssl=*)
			ssl_target="${arg#--ssl=}"
			ssl_explicit=1
			;;
		*)
			red "Unknown flag: $arg"
			exit 1
			;;
		esac
	done

	if [[ $ssl_explicit -eq 0 ]]; then
		if [[ ! -t 0 ]]; then
			red "Not in a terminal — specify the target explicitly: sudo ./install.sh ssl --ssl=DOMAIN-OR-IP"
			exit 1
		fi
		ssl_target=$(prompt_ssl_target)
	fi
	if [[ -z "$ssl_target" ]]; then
		echo "SSL skipped."
		return
	fi

	local base_path_default admin_password_seed base_path="" admin_password=""
	base_path_default=$(current_base_path_hint)
	admin_password_seed=$(current_admin_password_hint)
	if [[ -n "$admin_password_seed" ]] && probe_panel_login "$base_path_default" "$admin_password_seed"; then
		base_path="$base_path_default"
		admin_password="$admin_password_seed"
	else
		local input_base
		read -r -p "Panel URI path [${base_path_default}]: " input_base || true
		base_path="${input_base:-$base_path_default}"
		read -r -s -p "Current admin password: " admin_password || true
		echo
	fi

	issue_and_apply_ssl "$ssl_target" "$base_path" "$admin_password"
}

# run_setting_offline runs `wt-panel setting ...` (see cmd/server/
# setting.go) directly against the sqlite file, with the service stopped
# around it — always symmetric (stop, run, start) so a menu item can never
# accidentally leave the service down. Returns the setting command's own
# exit status (bad password length, bad base path, etc. all exit 1) instead
# of letting it propagate as a script-ending error under this script's own
# `set -e` — cmd_menu needs to tell success from failure and keep the menu
# loop going either way, not have the whole script die over one rejected
# input.
run_setting_offline() {
	systemctl stop "$SERVICE_NAME" 2>/dev/null || true
	local rc=0
	WTP_DATA_DIR="$DATA_DIR" WTP_DB_PATH="$DB_PATH" "$BIN_PATH" setting "$@" || rc=$?
	systemctl start "$SERVICE_NAME" 2>/dev/null || true
	return $rc
}

# cmd_menu is the interactive management menu — 3x-ui-style — reachable as
# `sudo wtp` (see install_wtp_command) or `sudo ./install.sh menu`, and as
# the default action of a bare `wtp`/`install.sh` with no arguments once the
# panel is already installed and a real terminal is attached (see the
# dispatcher below). Path/password/TLS-clear go straight through
# run_setting_offline rather than the panel's HTTP API, specifically so
# this still works when the panel itself won't start — exactly the
# situation a "reset my password" or "clear a bad TLS config" request
# usually comes from. SSL/restart/update/uninstall just call the existing
# cmd_ssl/cmd_install/cmd_uninstall — no separate logic to keep in sync.
# pause_for_key waits for a single keypress before the menu loop redraws —
# used after screens that are pure information (status, logs) rather than a
# short one-line action result, so the operator has a chance to actually
# read it before it scrolls away under the next menu redraw.
pause_for_key() {
	echo
	read -n 1 -r -s -p "Press any key to return to the menu..." || true
	echo
}

cmd_menu() {
	require_root
	if [[ ! -x "$BIN_PATH" ]]; then
		red "The panel isn't installed — first run: sudo ./install.sh"
		exit 1
	fi
	banner

	local choice
	while true; do
		echo
		cyan "════════ wt-panel ════════"
		echo "1. Status and current settings"
		echo "2. Change the URI path"
		echo "3. Reset the admin password"
		echo "4. Set up SSL"
		echo "5. Restart the panel"
		echo "6. Show logs"
		echo "7. Update the panel"
		echo "8. Remove the panel"
		echo "0. Exit"
		echo
		read -r -p "Choice: " choice || break
		echo
		case "$choice" in
		1)
			if systemctl is-active --quiet "$SERVICE_NAME"; then
				green "Service: active"
			else
				red "Service: not running"
			fi
			run_setting_offline -show || true
			pause_for_key
			;;
		2)
			local new_path
			read -r -p "New URI path (e.g. /abc123/): " new_path
			if run_setting_offline -webBasePath "$new_path"; then
				green "Path changed. The panel is now at: http://<SERVER-IP>:${LISTEN_PORT}${new_path}"
			fi
			;;
		3)
			local new_password
			read -r -p "New password (Enter to generate one): " new_password
			[[ -z "$new_password" ]] && new_password=$(random_hex 9)
			if run_setting_offline -password "$new_password"; then
				green "Password changed: ${new_password}"
			fi
			;;
		4)
			# `|| true` matters: apply_ssl_settings returns 1 on failure (e.g. a
			# wrong admin password), and under this script's `set -e` an
			# unguarded non-zero return here would kill the whole menu loop
			# instead of just redrawing it.
			cmd_ssl || true
			;;
		5)
			systemctl restart "$SERVICE_NAME"
			green "Restarted."
			;;
		6)
			journalctl -u "$SERVICE_NAME" -n 100 --no-pager
			pause_for_key
			;;
		7)
			cmd_install
			;;
		8)
			local confirm
			read -r -p "Really remove the panel? Data is kept unless you pass --purge separately. [y/N]: " confirm
			if [[ "$confirm" =~ ^[Yy]$ ]]; then
				cmd_uninstall
				return
			fi
			;;
		0)
			return
			;;
		*)
			red "Invalid choice."
			;;
		esac
	done
}

# A bare invocation with no arguments at all normally means "install"
# (fresh box, or the documented `sudo bash -c "$(curl ...)"` one-liner run
# again to update — must stay non-interactive-safe either way). The one
# exception: once the panel is already installed and a real terminal is
# attached, there's nothing left to "install" — show the management menu
# instead, same as typing `wtp`/`sudo ./install.sh menu` explicitly. A
# piped/non-interactive re-run (no tty) always keeps the install/update
# behavior, matching prompt_ssl_target's own `-t 0` convention.
default_cmd="install"
if [[ $# -eq 0 && -x "$BIN_PATH" && -t 0 ]]; then
	default_cmd="menu"
fi

# Every real (root) invocation of this script keeps /usr/local/bin/wtp in
# sync with whatever's actually running right now — not just cmd_install's
# own call to it. Without this, a bare `wtp`/one-liner run that resolves
# straight to the menu above never touches install_wtp_command at all
# (cmd_menu doesn't call cmd_install unless the operator explicitly picks
# "Update the panel"), so wtp can go stale forever while the panel binary
# itself keeps updating fine via GitHub Releases — confirmed on a real VPS:
# wt-panel reached v0.6.1 while wtp stayed on a pre-menu build the whole
# time, because every run had been landing in the menu, never in
# cmd_install. Silently skipped when not root, matching every cmd_*
# below (each calls require_root as its own first action anyway) rather
# than erroring here before one of them gets a chance to print a clearer
# message. `|| true` matters here specifically: a bare `[[ ... ]] &&
# install_wtp_command` at this top level would, under this script's own
# `set -e`, kill the ENTIRE script the instant install_wtp_command returns
# non-zero (e.g. a network hiccup fetching from GitHub) — silently, before
# ever reaching the case dispatcher below. Keeping wtp in sync is a nice-to-
# have on every run, not something that should ever be able to abort an
# otherwise-successful install/menu/ssl/uninstall invocation.
if [[ $EUID -eq 0 ]]; then
	install_wtp_command || true
fi

case "${1:-$default_cmd}" in
install)
	shift || true
	cmd_install "$@"
	;;
uninstall)
	shift || true
	cmd_uninstall "${1:-}"
	;;
ssl)
	shift || true
	cmd_ssl "$@"
	;;
menu)
	cmd_menu
	;;
--no-kernels | --skip-kernel=* | --ssl=* | --no-ssl | --from-source)
	cmd_install "$@"
	;;
*)
	red "Usage: $0 [install [--no-kernels] [--skip-kernel=NAME ...] [--ssl=DOMAIN-OR-IP] [--no-ssl] [--from-source]] | ssl [--ssl=DOMAIN-OR-IP] | menu | uninstall [--purge]"
	exit 1
	;;
esac
