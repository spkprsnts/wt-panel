#!/bin/bash
# wt-panel installer/updater/uninstaller — mirrors 3x-ui's one-line-install
# shape (systemd unit, enable --now) but scoped down and prompt-free by
# default: fresh installs get a random admin password and a random URI base
# path printed at the end instead of asked up front, since there's nothing
# sensible to default them to. The one exception is SSL target selection
# (see prompt_ssl_target below) — safe to ask interactively because the
# documented one-line install form (`bash -c "$(curl ...)"`) never consumes
# stdin, unlike `curl | bash`; non-interactive runs (no tty) just skip it.
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
#       the "Ядра" page. --no-kernels skips all of that; --skip-kernel=NAME
#       (repeatable, NAME one of turnable/freeturn/xray/webdav/olcrtc) skips
#       just that one.
#       SSL is on by default. With no --ssl/--no-ssl flag at all and a real
#       terminal attached (true for the one-line curl install too — see
#       prompt_ssl_target), it asks interactively: auto-detect this host's
#       own public IP (detect_public_ip — same three endpoints the panel
#       itself uses), a domain, a manual IP, or skip. Piped/non-interactive
#       runs (no tty) skip the prompt and just auto-detect the IP.
#       --ssl=DOMAIN-OR-IP names a specific target non-interactively instead
#       (a domain goes through Let's Encrypt, an IP through ZeroSSL);
#       --no-ssl skips SSL setup entirely. Either way it's acme.sh under the
#       hood — same dependency 3x-ui's own SSL menu uses — wired into the panel's own
#       HTTPS listener via its settings API. A failure here (port 80 busy,
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
#       is given; then asks for the panel's current URI base path (hinted
#       from the install-time value) and admin password (always asked,
#       never assumed, since either may have changed since install) to
#       authenticate and push the cert through. See cmd_ssl.
#   sudo ./install.sh uninstall      stop+remove the service and binary, keep data
#   sudo ./install.sh uninstall --purge   also delete the data directory (DB, kernel binaries)
set -euo pipefail

INSTALL_DIR="${WTP_INSTALL_DIR:-/usr/local/wt-panel}"
SERVICE_NAME="wt-panel"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DATA_DIR="${INSTALL_DIR}/data"
DB_PATH="${DATA_DIR}/wtpanel.db"
BIN_PATH="${INSTALL_DIR}/wt-panel"
LISTEN_PORT="${WTP_LISTEN_PORT:-8090}"
REPO="${WTP_REPO:-spkprsnts/wt-panel}"
# ACME_EMAIL is used both to install acme.sh (its default account email) and
# to register/issue against ZeroSSL specifically (see setup_ssl) — ZeroSSL's
# ACME endpoint requires an EAB-bound account and only auto-resolves the EAB
# kid/hmac when an --accountemail is actually presented on the request; a
# bare `--issue --server zerossl` with no email registered for that CA fails
# with "Cannot resolve _eab_kid" (hit on a real fresh VPS).
ACME_EMAIL="admin@$(hostname -f 2>/dev/null || echo localhost)"

# BASH_SOURCE[0] is unset when this script runs via `bash -c "$(curl ...)"`
# (the documented one-line install/uninstall) rather than as a real file on
# disk — ${BASH_SOURCE[0]:-$0} falls back to $0 so `set -u` doesn't abort
# before anything else has a chance to run. The fallback value itself is
# only ever consulted by build_from_source's "is this a checked-out repo"
# check below, which is meant to fail in exactly this piped-execution case.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

red() { echo -e "\033[0;31m$1\033[0m"; }
green() { echo -e "\033[0;32m$1\033[0m"; }

require_root() {
	if [[ $EUID -ne 0 ]]; then
		red "Запустите от root: sudo $0 $*"
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
	echo "git не найден — устанавливаю..."
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
	echo "go не найден — ставлю официальную сборку с go.dev..."
	ensure_apt_updated
	apt-get install -y -qq curl
	local arch
	case "$(uname -m)" in
	x86_64) arch=amd64 ;;
	aarch64) arch=arm64 ;;
	*)
		red "Неизвестная архитектура $(uname -m) — поставьте Go вручную с https://go.dev/dl/"
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
	echo "node/npm не найдены (или слишком старые) — ставлю Node.js 22.x через NodeSource..."
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
		red "Не могу собрать из исходников: $SCRIPT_DIR — не копия репозитория."
		red "Склонируйте репозиторий (git clone https://github.com/${REPO}) и запустите install.sh оттуда, либо дождитесь релиза."
		exit 1
	fi

	ensure_git
	ensure_go
	ensure_node

	echo "Собираю фронтенд..."
	(cd "$SCRIPT_DIR/frontend" && npm ci --silent && npm run build --silent)

	rm -rf "$SCRIPT_DIR/backend/internal/webui/dist"
	mkdir -p "$SCRIPT_DIR/backend/internal/webui/dist"
	cp -r "$SCRIPT_DIR/frontend/dist/." "$SCRIPT_DIR/backend/internal/webui/dist/"

	echo "Собираю бэкенд..."
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

	echo "Проверяю релизы ${REPO}..."
	local release_json
	release_json=$(curl -fsSL --max-time 10 "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null) || return 1

	local tag version asset_url
	tag=$(echo "$release_json" | jq -r '.tag_name // empty' 2>/dev/null) || return 1
	[[ -z "$tag" ]] && return 1
	version="${tag#v}"
	asset_url=$(echo "$release_json" | jq -r --arg name "wt-panel-${version}-linux-${arch}.tar.gz" \
		'.assets[]? | select(.name == $name) | .browser_download_url' 2>/dev/null)
	if [[ -z "$asset_url" ]]; then
		red "В релизе ${tag} нет сборки под linux-${arch}."
		return 1
	fi

	echo "Скачиваю wt-panel ${tag} (linux-${arch})..."
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
	green "Скачан релиз ${tag}."
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
	echo "Релиз недоступен — собираю из исходников..."
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

# wait_for_panel polls the just-started panel until it answers HTTP requests
# at all (any status code counts — /api/login on GET is expected to 404/405,
# this is purely "is something listening yet", not an auth check).
wait_for_panel() {
	local base="$1" i=0 code
	while [[ $i -lt 30 ]]; do
		code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${LISTEN_PORT}${base}api/login" 2>/dev/null || true)
		[[ -n "$code" && "$code" != "000" ]] && return 0
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

# install_kernels auto-installs/builds every kernel right after a fresh
# install, so a brand new box is immediately usable without a separate trip
# to the "Ядра" page. Skippable in whole (--no-kernels) or in part
# (--skip-kernel=NAME, repeatable). Only ever called for a fresh install —
# see cmd_install — so this never re-triggers a slow olcRTC rebuild on a
# routine update.
install_kernels() {
	local admin_password="$1" base="$2"

	if ! wait_for_panel "$base"; then
		red "Панель не отвечает — пропускаю автоустановку ядер (сделайте это вручную на странице «Ядра»)."
		return
	fi

	local login_resp token
	login_resp=$(curl -fsS --max-time 10 -X POST "http://127.0.0.1:${LISTEN_PORT}${base}api/login" \
		-H 'Content-Type: application/json' \
		-d "{\"username\":\"admin\",\"password\":\"${admin_password}\"}") || {
		red "Не удалось войти в панель для автоустановки ядер — сделайте это вручную на странице «Ядра»."
		return
	}
	token=$(json_field "$login_resp" token)
	if [[ -z "$token" ]]; then
		red "Вход в панель не вернул токен — пропускаю автоустановку ядер."
		return
	fi

	local api="http://127.0.0.1:${LISTEN_PORT}${base}api"
	auth_curl() { curl -fsS --max-time 120 -H "Authorization: Bearer ${token}" "$@"; }

	if ! kernel_skipped turnable; then
		echo "Устанавливаю Turnable..."
		auth_curl -X POST "${api}/kernels/turnable/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  Turnable установлен." || red "  Не удалось установить Turnable (см. страницу «Ядра»)."
	fi

	if ! kernel_skipped freeturn; then
		echo "Устанавливаю FreeTurn..."
		auth_curl -X POST "${api}/kernels/freeturn/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  FreeTurn установлен." || red "  Не удалось установить FreeTurn (см. страницу «Ядра»)."
	fi

	if ! kernel_skipped xray; then
		echo "Устанавливаю Xray-core..."
		auth_curl -X POST "${api}/kernels/xray/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  Xray-core установлен." || red "  Не удалось установить Xray-core (см. страницу «Ядра»)."
	fi

	if ! kernel_skipped webdav; then
		echo "Устанавливаю webdav-tunnel..."
		auth_curl -X POST "${api}/kernels/webdav/install" -H 'Content-Type: application/json' -d '{}' >/dev/null \
			&& green "  webdav-tunnel установлен." || red "  Не удалось установить webdav-tunnel (см. страницу «Ядра»)."
	fi

	if ! kernel_skipped olcrtc; then
		echo "Собираю olcRTC из исходников (ref: ${OLCRTC_REF:-master})... это может занять несколько минут."
		local build_resp job_id status i=0
		build_resp=$(auth_curl -X POST "${api}/kernels/olcrtc/build" -H 'Content-Type: application/json' \
			-d "{\"ref\":\"${OLCRTC_REF:-master}\"}") || {
			red "  Не удалось запустить сборку olcRTC (см. страницу «Ядра»)."
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
			success) green "  olcRTC собран." ;;
			failed) red "  Сборка olcRTC не удалась (см. страницу «Ядра» для лога)." ;;
			*) red "  Сборка olcRTC не завершилась за отведённое время — проверьте страницу «Ядра»." ;;
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
# finds it already there.
ensure_acme_sh() {
	[[ -x ~/.acme.sh/acme.sh ]] && return
	echo "acme.sh не найден — устанавливаю..."
	ensure_apt_updated
	apt-get install -y -qq curl socat cron
	curl -fsSL https://get.acme.sh | sh -s email="$ACME_EMAIL" >/dev/null
}

# register_zerossl_account fetches EAB (External Account Binding)
# credentials from ZeroSSL's free, no-signup "eab-credentials-email"
# endpoint and hands them to acme.sh explicitly via --register-account.
# ZeroSSL's ACME endpoint requires EAB and acme.sh does have its own
# built-in flow for resolving it from just an --accountemail during
# --issue, but that path has been seen failing outright with "Cannot
# resolve _eab_kid" on a real VPS even with --accountemail passed — doing
# the same HTTP call ourselves and registering explicitly sidesteps
# whatever's broken there. Non-fatal on failure (network hiccup, endpoint
# down): setup_ssl's own --issue still runs afterward and will surface
# a clear error itself if the account truly isn't usable.
register_zerossl_account() {
	ensure_jq
	local resp kid hmac
	resp=$(curl -fsS --data "email=${ACME_EMAIL}" https://api.zerossl.com/acme/eab-credentials-email 2>/dev/null) || return 1
	kid=$(echo "$resp" | jq -r '.eab_kid // empty' 2>/dev/null)
	hmac=$(echo "$resp" | jq -r '.eab_hmac_key // empty' 2>/dev/null)
	[[ -n "$kid" && -n "$hmac" ]] || return 1
	~/.acme.sh/acme.sh --register-account --server zerossl --eab-kid "$kid" --eab-hmac-key "$hmac" >/dev/null 2>&1
}

# setup_ssl TARGET issues a real TLS cert for TARGET (a domain, via Let's
# Encrypt, or a bare IP address, via ZeroSSL — Let's Encrypt itself has no
# IP-certificate program, ZeroSSL's ACME endpoint does, see
# register_zerossl_account above for how the account gets EAB-registered)
# and prints the two file paths on success. Uses acme.sh's standalone mode,
# so port 80 must be free for the few seconds the HTTP-01 challenge takes —
# same requirement 3x-ui's own SSL setup has. --reloadcmd restarts the panel
# automatically on every renewal (acme.sh installs its own cron job for
# that), not just this first issuance.
setup_ssl() {
	local target="$1"
	ensure_acme_sh

	mkdir -p "${DATA_DIR}/ssl"
	local cert_file="${DATA_DIR}/ssl/${target}.crt"
	local key_file="${DATA_DIR}/ssl/${target}.key"

	local issue_args=(--issue -d "$target" --standalone --force)
	if [[ "$target" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		echo "Выпускаю TLS-сертификат для IP ${target} через ZeroSSL..."
		register_zerossl_account || true
		issue_args+=(--server zerossl --accountemail "$ACME_EMAIL")
	else
		echo "Выпускаю TLS-сертификат для домена ${target} через Let's Encrypt..."
	fi

	if ! ~/.acme.sh/acme.sh "${issue_args[@]}"; then
		red "Не удалось выпустить сертификат для ${target} — убедитесь, что порт 80 свободен и ${target} действительно указывает на этот сервер. Настройте SSL вручную позже на странице «Настройки»."
		return 1
	fi

	if ! ~/.acme.sh/acme.sh --install-cert -d "$target" \
		--key-file "$key_file" \
		--fullchain-file "$cert_file" \
		--reloadcmd "systemctl restart ${SERVICE_NAME} 2>/dev/null || true"; then
		red "Сертификат для ${target} выпущен, но не удалось установить его в ${DATA_DIR}/ssl — настройте SSL вручную на странице «Настройки»."
		return 1
	fi

	printf '%s\n%s\n' "$cert_file" "$key_file"
}

# apply_ssl_settings pushes the issued cert's paths (and, for a domain, the
# hostname) into the panel's own PanelSettings via its settings API — same
# API the Settings page's "Сеть панели" card uses — then restarts the
# service so main.go's ListenAndServeTLS branch picks them up (it only reads
# this row once at startup, see handlers_panel_settings.go). GETs the
# current settings first and only overwrites TLS/domain fields: the PUT
# endpoint replaces the whole row, so blindly sending zero values for
# ListenIP/ListenPort/BasePath would reset those to their unset defaults.
apply_ssl_settings() {
	local target="$1" cert_file="$2" key_file="$3" base="$4" admin_password="$5"

	local login_resp token
	login_resp=$(curl -fsS --max-time 10 -X POST "http://127.0.0.1:${LISTEN_PORT}${base}api/login" \
		-H 'Content-Type: application/json' \
		-d "{\"username\":\"admin\",\"password\":\"${admin_password}\"}") || {
		red "Не удалось войти в панель, чтобы применить SSL-настройки — задайте пути к сертификату вручную на странице «Настройки»."
		return
	}
	token=$(json_field "$login_resp" token)
	[[ -z "$token" ]] && return

	local current
	current=$(curl -fsS --max-time 10 -H "Authorization: Bearer ${token}" \
		"http://127.0.0.1:${LISTEN_PORT}${base}api/settings/panel") || return
	local listen_ip listen_port base_path public_ip
	listen_ip=$(json_field "$current" ListenIP)
	listen_port=$(json_field "$current" ListenPort)
	base_path=$(json_field "$current" BasePath)
	public_ip=$(json_field "$current" PublicIP)
	[[ -z "$listen_port" ]] && listen_port=0
	local listen_domain=""
	[[ ! "$target" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && listen_domain="$target"

	curl -fsS --max-time 10 -X PUT "http://127.0.0.1:${LISTEN_PORT}${base}api/settings/panel" \
		-H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' \
		-d "{\"listenIp\":\"${listen_ip}\",\"listenDomain\":\"${listen_domain}\",\"listenPort\":${listen_port},\"basePath\":\"${base_path}\",\"tlsCertFile\":\"${cert_file}\",\"tlsKeyFile\":\"${key_file}\",\"publicIp\":\"${public_ip}\"}" \
		>/dev/null || {
		red "Не удалось сохранить SSL-настройки панели — задайте пути к сертификату вручную на странице «Настройки»."
		return
	}

	systemctl restart "$SERVICE_NAME"
	green "SSL настроен — панель теперь на https://${target}:${LISTEN_PORT}${base}"
}

# issue_and_apply_ssl is the setup_ssl + apply_ssl_settings pair cmd_install
# (fresh installs) and cmd_ssl (an already-installed panel, run later) both
# need — kept as one function so a change to that sequence doesn't have to
# be made twice.
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

install_service_unit() {
	local admin_password="$1" base_path="$2"
	local extra_env=""
	[[ -n "$admin_password" ]] && extra_env+=$'\n'"Environment=WTP_ADMIN_PASSWORD=${admin_password}"
	[[ -n "$base_path" ]] && extra_env+=$'\n'"Environment=WTP_INITIAL_BASE_PATH=${base_path}"

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
	echo "Настройка SSL:" >&2
	echo "  1) Автоопределить IP этого сервера — ZeroSSL (по умолчанию)" >&2
	echo "  2) Указать домен — Let's Encrypt" >&2
	echo "  3) Указать IP вручную — ZeroSSL" >&2
	echo "  4) Пропустить" >&2
	local choice="" target=""
	read -r -p "Выбор [1-4, Enter=1]: " choice || true
	case "$choice" in
	2)
		read -r -p "Домен: " target || true
		;;
	3)
		read -r -p "IP: " target || true
		;;
	4)
		target=""
		;;
	*)
		echo "Определяю публичный IP..." >&2
		target=$(detect_public_ip) || true
		if [[ -z "$target" ]]; then
			red "Не удалось определить публичный IP — SSL будет пропущен. Настройте вручную: sudo ./install.sh --ssl=IP-ИЛИ-ДОМЕН, либо на странице «Настройки»." >&2
		fi
		;;
	esac
	echo "$target"
}

cmd_install() {
	require_root

	local no_kernels=0 skip_kernels="" ssl_target="" ssl_explicit=0 no_ssl=0 from_source=0
	local arg
	for arg in "$@"; do
		case "$arg" in
		--no-kernels) no_kernels=1 ;;
		--skip-kernel=*) skip_kernels="${skip_kernels} ${arg#--skip-kernel=}" ;;
		--ssl=*)
			ssl_target="${arg#--ssl=}"
			ssl_explicit=1
			;;
		--no-ssl) no_ssl=1 ;;
		--from-source) from_source=1 ;;
		*)
			red "Неизвестный флаг: $arg"
			exit 1
			;;
		esac
	done

	mkdir -p "$INSTALL_DIR" "$DATA_DIR"

	local fresh=1
	[[ -f "$DB_PATH" ]] && fresh=0

	get_binary "$from_source"

	systemctl stop "$SERVICE_NAME" 2>/dev/null || true
	mv "${BIN_PATH}.new" "$BIN_PATH"
	chmod +x "$BIN_PATH"

	local admin_password="" base_path=""
	if [[ $fresh -eq 1 ]]; then
		# 9 bytes -> 18 hex chars for the password, 4 -> 8 for the path
		# segment — both env-var-seeded once, on this very first boot (see
		# db.seedAdmin/seedPanelSettings); safe to leave in the unit file
		# permanently since they're no-ops once the rows exist.
		admin_password=$(random_hex 9)
		base_path="/$(random_hex 4)/"
	fi

	install_service_unit "$admin_password" "$base_path"
	systemctl enable --now "$SERVICE_NAME"

	sleep 1
	if [[ $fresh -eq 1 ]]; then
		green "Установлено и запущено."
		echo "  Логин:    admin"
		echo "  Пароль:   ${admin_password}"
		echo "  URI-путь: ${base_path}"
		echo "  Панель:   http://<IP-сервера>:${LISTEN_PORT}${base_path}"
		echo "Эти значения также сохранены в ${SERVICE_FILE} — посмотреть снова: systemctl cat ${SERVICE_NAME}"

		if [[ $no_kernels -eq 1 ]]; then
			echo "Автоустановка ядер пропущена (--no-kernels)."
		else
			install_kernels "$admin_password" "$base_path"
		fi

		if [[ $no_ssl -eq 1 ]]; then
			echo "SSL пропущен (--no-ssl)."
		else
			if [[ $ssl_explicit -eq 0 && -t 0 ]]; then
				ssl_target=$(prompt_ssl_target)
			elif [[ $ssl_explicit -eq 0 ]]; then
				echo "Определяю публичный IP для SSL (по умолчанию — ZeroSSL на IP; свой домен: --ssl=DOMAIN, отключить: --no-ssl)..."
				ssl_target=$(detect_public_ip) || true
				if [[ -z "$ssl_target" ]]; then
					red "Не удалось определить публичный IP — пропускаю SSL. Настройте вручную: sudo ./install.sh --ssl=IP-ИЛИ-ДОМЕН, либо на странице «Настройки»."
				fi
			fi
			if [[ -n "$ssl_target" ]]; then
				issue_and_apply_ssl "$ssl_target" "$base_path" "$admin_password"
			fi
		fi
	else
		green "Обновлено и перезапущено (данные в ${DATA_DIR} сохранены)."
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
		green "Панель и все данные (${INSTALL_DIR}) удалены."
	else
		rm -f "$BIN_PATH"
		green "Панель удалена, данные сохранены в ${DATA_DIR}."
		echo "Для полного удаления вместе с данными: $0 uninstall --purge"
	fi
}

# cmd_ssl (re-)runs SSL setup against a panel that's already installed and
# running — cmd_install's own SSL step only ever fires on a fresh install
# (see its own doc comment), so this is how to add/replace a cert later:
# switching from IP to a domain once DNS is pointed, retrying after a
# transient acme.sh failure, or setting SSL up for the first time on a box
# that was installed with --no-ssl. Needs the current admin password (the
# panel may have changed since install, so this always asks rather than
# trusting a stale WTP_ADMIN_PASSWORD seed) and the current URI base path
# (defaulted from the seed, same caveat — see current_base_path_hint).
cmd_ssl() {
	require_root
	if [[ ! -x "$BIN_PATH" ]]; then
		red "Панель не установлена — сначала: sudo ./install.sh"
		exit 1
	fi
	if ! systemctl is-active --quiet "$SERVICE_NAME"; then
		red "Служба ${SERVICE_NAME} не запущена — sudo systemctl start ${SERVICE_NAME}"
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
			red "Неизвестный флаг: $arg"
			exit 1
			;;
		esac
	done

	if [[ $ssl_explicit -eq 0 ]]; then
		if [[ ! -t 0 ]]; then
			red "Не в терминале — укажите цель явно: sudo ./install.sh ssl --ssl=DOMAIN-ИЛИ-IP"
			exit 1
		fi
		ssl_target=$(prompt_ssl_target)
	fi
	if [[ -z "$ssl_target" ]]; then
		echo "SSL пропущен."
		return
	fi

	local base_path_default input_base base_path admin_password
	base_path_default=$(current_base_path_hint)
	read -r -p "URI-путь панели [${base_path_default}]: " input_base || true
	base_path="${input_base:-$base_path_default}"
	read -r -s -p "Текущий пароль admin: " admin_password || true
	echo

	issue_and_apply_ssl "$ssl_target" "$base_path" "$admin_password"
}

case "${1:-install}" in
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
--no-kernels | --skip-kernel=* | --ssl=* | --no-ssl | --from-source)
	cmd_install "$@"
	;;
*)
	red "Использование: $0 [install [--no-kernels] [--skip-kernel=NAME ...] [--ssl=DOMAIN-OR-IP] [--no-ssl] [--from-source]] | ssl [--ssl=DOMAIN-OR-IP] | uninstall [--purge]"
	exit 1
	;;
esac
