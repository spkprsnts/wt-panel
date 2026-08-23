# wt-panel

Control-plane для клиентов [WireTurn](https://github.com/spkprsnts/WireTurn):
управляет серверными процессами всех четырёх ядер (Turnable, olcRTC, WebDAV,
FreeTurn), навешивает xray/WireGuard-оверлей и отдаёт подписки в формате
`ProfileBundle` (`docs/subscriptions.md` апстрима).

## Стек

- **Backend**: Go (gin + gorm + SQLite), один бинарник — `backend/`
- **Frontend**: React + Vite + TypeScript + Tailwind v4 + shadcn/ui — `frontend/`

Только Linux (systemd).

## Быстрый старт

**Установка на сервер:**

```sh
curl -fsSL https://raw.githubusercontent.com/spkprsnts/wt-panel/main/install.sh -o install.sh
sudo bash install.sh
```

Логин/пароль и адрес панели печатаются один раз по завершении.

**Разработка:**

```sh
./dev.sh          # backend :8090 + frontend :5173 в одном терминале
./dev.sh --host    # то же, но доступно по LAN
```

## Лицензия

MIT — см. [LICENSE](LICENSE).
