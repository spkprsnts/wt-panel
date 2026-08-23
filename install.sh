#!/bin/bash
# wt-panel installer/updater/uninstaller — mirrors 3x-ui's one-line-install
# shape (systemd unit, enable --now) but scoped down and non-interactive by
# design: no prompts at all. Fresh installs get a random admin password and
# a random URI base path printed at the end instead of asked up front,
# since there's nothing sensible to default them to and a prompt would
# break `curl | bash`-style piping.
#
# Currently builds from source (this script must be run from inside a
# checked-out copy of the repo) rather than downloading a release —
# swap build_from_source for a curl-from-GitHub-releases fetch once wt-panel
# has actual releases published; see README.
#
# Usage:
#   sudo ./install.sh [install] [--no-kernels] [--skip-kernel=NAME ...]
#       fresh install, or update if already installed. On a fresh install
#       (only — an update never re-triggers this) also installs/builds every
#       kernel (Turnable/FreeTurn/Xray-core from GitHub Releases, olcRTC
#       built from source at OLCRTC_REF, default "master"), so a brand new
#       box is immediately usable without a separate trip to the "Ядра"
#       page. --no-kernels skips all of that; --skip-kernel=NAME (repeatable,
#       NAME one of turnable/freeturn/xray/olcrtc) skips just that one.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

build_from_source() {
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

# json_field EXTRACTS a top-level string/number field's value from a small
# JSON blob without depending on jq/python3 — deliberate, matching the same
# "fresh minimal system" bootstrapping philosophy as ensure_go/ensure_node
# above: a brand new box may have neither. Only handles the flat shapes the
# API responses below actually return (quoted strings or bare identifiers).
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

cmd_install() {
	require_root

	local no_kernels=0 skip_kernels=""
	local arg
	for arg in "$@"; do
		case "$arg" in
		--no-kernels) no_kernels=1 ;;
		--skip-kernel=*) skip_kernels="${skip_kernels} ${arg#--skip-kernel=}" ;;
		*)
			red "Неизвестный флаг: $arg"
			exit 1
			;;
		esac
	done

	mkdir -p "$INSTALL_DIR" "$DATA_DIR"

	local fresh=1
	[[ -f "$DB_PATH" ]] && fresh=0

	build_from_source

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

case "${1:-install}" in
install)
	shift || true
	cmd_install "$@"
	;;
uninstall)
	shift || true
	cmd_uninstall "${1:-}"
	;;
--no-kernels | --skip-kernel=*)
	cmd_install "$@"
	;;
*)
	red "Использование: $0 [install [--no-kernels] [--skip-kernel=NAME ...]] | uninstall [--purge]"
	exit 1
	;;
esac
