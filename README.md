# wt-panel

Control-plane для пользователей [WireTurn](https://github.com/spkprsnts/WireTurn):
управляет серверными процессами всех четырёх ядер —
[Turnable](https://github.com/TheAirBlow/Turnable),
[olcRTC](https://github.com/openlibrecommunity/olcrtc),
[WebDAV-tunnel](https://github.com/spkprsnts/webdav-tunnel),
[FreeTurn](https://github.com/samosvalishe/free-turn-proxy) — навешивает
поверх них Xray-оверлей (VLESS/Trojan/Hysteria2/WireGuard) и отдаёт подписки
в формате `ProfileBundle` (`docs/subscriptions.md` апстрима).

Панель не привязана только к WireTurn. У подписки клиента (все его профили
разом) помимо `ProfileBundle` есть и обычный текстовый вариант
(`?format=text`) — список URI профилей построчно, а у каждого отдельного
профиля есть свой прямой URI ядра (`turnable://...`, `freeturn://...` и
т.п.) — формат каждого задокументирован в репозитории соответствующего ядра
(ссылки выше), так что профили годятся и для других клиентов, которые эти
URI поддерживают, а не только для WireTurn. Xray здесь — вспомогательный
оверлей поверх основных ядер (камуфляж трафика/dual route), а не отдельный
самостоятельный протокол.

## Стек

- **Backend**: Go (gin + gorm + SQLite), один бинарник — `backend/`
- **Frontend**: React + Vite + TypeScript + Tailwind v4 + shadcn/ui — `frontend/`

Только Linux (systemd).

## Быстрый старт

**Установка на сервер:**

```sh
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/spkprsnts/wt-panel/main/install.sh)"
```

Логин/пароль и адрес панели печатаются один раз по завершении. Установка
также кладёт команду `wtp` — управление панелью после этого:

```sh
sudo wtp
```

Интерактивное меню: статус/путь, смена URI-пути, сброс пароля admin, SSL,
рестарт, логи, обновление, удаление — работает напрямую с базой панели, так
что доступно даже если сама панель не поднимается.

**Настройка SSL позже** (если пропустили при установке или меняете домен/IP):

```sh
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/spkprsnts/wt-panel/main/install.sh)" -- ssl
```

**Удаление** (сервис + бинарник, данные остаются):

```sh
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/spkprsnts/wt-panel/main/install.sh)" -- uninstall
```

**Полное удаление** (плюс база данных и бинарники ядер):

```sh
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/spkprsnts/wt-panel/main/install.sh)" -- uninstall --purge
```

**Разработка:**

```sh
./dev.sh          # backend :8090 + frontend :5173 в одном терминале
./dev.sh --host    # то же, но доступно по LAN
```

## Лицензия

MIT — см. [LICENSE](LICENSE).
