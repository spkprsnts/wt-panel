export const settings = {
  ru: {
    "settings.pageTitle": "Настройки",

    "settings.account.title": "Аккаунт",
    "settings.account.loggedInAs": "Вход выполнен как",
    "settings.account.currentPassword": "Текущий пароль",
    "settings.account.newPassword": "Новый пароль",
    "settings.account.confirmPassword": "Повторите новый пароль",
    "settings.account.passwordMismatch": "Новые пароли не совпадают",
    "settings.account.changeFailed": "Не удалось сменить пароль",
    "settings.account.changed": "Пароль изменён",
    "settings.account.changePassword": "Сменить пароль",

    "settings.account.totp.title": "Двухфакторная аутентификация (2FA)",
    "settings.account.totp.statusOn": "Включена",
    "settings.account.totp.statusOff": "Выключена — при входе достаточно пароля",
    "settings.account.totp.enableButton": "Включить 2FA",
    "settings.account.totp.enableTitle": "Включение 2FA",
    "settings.account.totp.enableDescription":
      "Отсканируйте QR-код в приложении-аутентификаторе (Google Authenticator, Authy и т.п.) или введите секрет вручную, затем подтвердите код из приложения.",
    "settings.account.totp.setupFailed": "Не удалось сгенерировать секрет",
    "settings.account.totp.codeLabel": "Код из приложения",
    "settings.account.totp.confirmButton": "Подтвердить и включить",
    "settings.account.totp.confirmFailed": "Не удалось подтвердить код",
    "settings.account.totp.disableButton": "Выключить 2FA",
    "settings.account.totp.disableTitle": "Выключение 2FA",
    "settings.account.totp.disableDescription": "Введите текущий код из приложения, чтобы подтвердить выключение.",
    "settings.account.totp.disableFailed": "Не удалось выключить 2FA",

    "settings.network.title": "Сеть панели",
    "settings.network.description":
      "Сохраняется сразу, но применяется только после перезапуска панели — процесс читает эти настройки один раз при старте",
    "settings.network.insecureWarning":
      "Вы открыли панель по незащищённому http — пароль и токен авторизации передаются в открытом виде. Настройте TLS-сертификат ниже (или SSL на реверс-прокси перед панелью) и открывайте панель по https.",
    "settings.network.saveFailed": "Не удалось сохранить",
    "settings.network.restartConfirm":
      "Перезапустить панель? Все процессы ядер (Turnable/olcRTC/FreeTurn/WebDAV) будут остановлены и подняты заново — активные звонки на пару секунд прервутся.",
    "settings.network.restartButton": "Перезапустить панель",
    "settings.network.restartFailed": "Не удалось запустить перезапуск",
    "settings.network.restartDialogTitle": "Перезапуск панели",
    "settings.network.restartDialogMessage":
      "Панель перезапускается — эта страница сама перейдёт на новый адрес, если менялись домен/порт/URI-путь.",
    "settings.network.publicIpLabel": "Публичный IP/хост VPS",
    "settings.network.publicIpPlaceholder": "Автоматически определяется при первом запуске",
    "settings.network.publicIpHelp":
      "Зашивается в конфиг клиентов Turnable/FreeTurn — определяется автоматически при первой установке панели, но может ошибиться (несколько сетевых интерфейсов, NAT, IPv6-only). Пустое значение — причина ошибки Turnable \"public_ip is required\".",
    "settings.network.webdavPublicHostLabel": "Публичный хост для WebDAV",
    "settings.network.webdavPublicHostPlaceholder": "Пусто — использовать публичный IP выше",
    "settings.network.webdavPublicHostHelp":
      "Хост, который получают клиенты WebDAV-профилей. Задайте, если для WebDAV нужен домен, а не голый IP — например, если сертификат панели выпущен на домен.",
    "settings.network.listenIpLabel": "IP-адрес для управления панелью",
    "settings.network.listenIpPlaceholder": "Оставьте пустым для подключения с любого IP",
    "settings.network.listenDomainLabel": "Домен панели",
    "settings.network.listenDomainPlaceholder": "Оставьте пустым для подключения с любых доменов и IP",
    "settings.network.listenPortLabel": "Порт панели",
    "settings.network.listenPortPlaceholder": "По умолчанию",
    "settings.network.listenPortHelp": "Порт, на котором работает панель",
    "settings.network.basePathLabel": "URI-путь",
    "settings.network.basePathHelp": "Должен начинаться с '/' и заканчиваться '/'",
    "settings.network.tlsCertLabel": "Путь к файлу публичного ключа сертификата панели",
    "settings.network.tlsKeyLabel": "Путь к файлу приватного ключа сертификата панели",
    "settings.network.pathPlaceholder": "Введите полный путь, начинающийся с '/'",
    "settings.network.saved": "Сохранено — перезапустите панель, чтобы изменения вступили в силу",

    "settings.restartDialog.timedOut":
      "Панель дольше обычного не перезапускается или новый адрес не отвечает. Если менялся IP/домен/порт, откройте панель по новому адресу вручную. Проверьте на сервере: journalctl -u wt-panel.",

    "settings.update.title": "Обновление панели",
    "settings.update.description": "Обновление wt-panel с GitHub Releases",
    "settings.update.checkFailed": "Не удалось проверить обновления",
    "settings.update.confirm":
      "Обновить панель? Все процессы ядер (Turnable/olcRTC/FreeTurn/WebDAV) будут остановлены и подняты заново — активные звонки на пару секунд прервутся.",
    "settings.update.button": "Обновить",
    "settings.update.startFailed": "Не удалось запустить обновление",
    "settings.update.dialogTitle": "Обновление панели",
    "settings.update.dialogMessage":
      "Скачиваем новую версию и перезапускаем панель — эта страница обновится сама, как только новая версия окажется доступна.",
    "settings.update.devBuild": "Недоступно — эта сборка запущена из исходников (dev), а не из релиза.",
    "settings.update.currentVersion": "Текущая версия:",
    "settings.update.versionAvailable": "Доступна версия",
    "settings.update.upToDate": "Установлена последняя версия",
    "settings.update.checking": "Проверяем...",
    "settings.update.check": "Проверить обновления",

    "settings.backup.title": "Бэкап",
    "settings.backup.description":
      "Полный снимок панели (настройки, все клиенты и профили, xray-инбаунды, аккаунт админа) в один файл — для восстановления после переустановки/переезда на другой VPS",
    "settings.backup.downloadButton": "Скачать бэкап (.db)",
    "settings.backup.downloadFailed": "Не удалось скачать бэкап",
    "settings.backup.restoreButton": "Восстановить из бэкапа",
    "settings.backup.restoreNetworkSettingsLabel": "Восстановить и сетевые настройки из бэкапа",
    "settings.backup.restoreNetworkSettingsOffHint":
      "Выключено (рекомендуется при переезде на другой VPS) — IP, домен, порт и пути к TLS-сертификату останутся текущими, а не из бэкапа.",
    "settings.backup.restoreNetworkSettingsOnHint":
      "Включено — IP, домен, порт и пути к TLS-сертификату тоже будут заменены значениями из бэкапа. Имеет смысл только при восстановлении на той же машине, где бэкап был сделан.",
    "settings.backup.restoreConfirm":
      "Восстановить панель из этого файла? Все текущие клиенты, профили, инбаунды и аккаунт администратора (включая пароль и 2FA) будут безвозвратно заменены содержимым бэкапа. Сетевые настройки (IP/домен/SSL) этой машины останутся прежними. Панель перезапустится.",
    "settings.backup.restoreConfirmWithNetwork":
      "Восстановить панель из этого файла? Все текущие клиенты, профили, инбаунды, аккаунт администратора (включая пароль и 2FA) И сетевые настройки (IP/домен/пути к SSL-сертификату) будут безвозвратно заменены содержимым бэкапа. Панель перезапустится.",
    "settings.backup.restoreFailed": "Не удалось восстановить из бэкапа",
    "settings.backup.restoreDialogTitle": "Восстановление из бэкапа",
    "settings.backup.restoreDialogMessage":
      "Заменяем базу данных панели и перезапускаемся — эта страница обновится сама, как только панель снова будет доступна.",

    "settings.config.title": "Конфигурация панели",
    "settings.config.description":
      "Только для чтения — задаётся через переменные окружения (см. README), для изменения нужно перезапустить панель",

    "settings.label.listenAddr": "Адрес панели",
    "settings.label.publicOrigin": "Публичный origin (для ссылок подписки)",
    "settings.label.dataDir": "Каталог данных",
    "settings.label.turnableBinPath": "Бинарник Turnable",
    "settings.label.olcrtcBinPath": "Бинарник olcRTC",
    "settings.label.webdavBinPath": "Бинарник WebDAV",
    "settings.label.freeturnBinPath": "Бинарник FreeTurn",
    "settings.label.turnableListenHost": "Turnable — интерфейс прослушивания",
    "settings.label.freeturnListenHost": "FreeTurn — интерфейс прослушивания",
    "settings.label.webdavListenHost": "WebDAV — интерфейс прослушивания",
    "settings.label.turnableDefaultRouteHost": "Turnable — хост маршрута по умолчанию",
    "settings.label.freeturnDefaultConnectHost": "FreeTurn — хост -connect по умолчанию",
    "settings.label.webdavDefaultProxyUpstream": "WebDAV — upstream-прокси по умолчанию",
    "settings.label.webdavPublicHost": "WebDAV — публичный хост",
  },
  en: {
    "settings.pageTitle": "Settings",

    "settings.account.title": "Account",
    "settings.account.loggedInAs": "Logged in as",
    "settings.account.currentPassword": "Current password",
    "settings.account.newPassword": "New password",
    "settings.account.confirmPassword": "Confirm new password",
    "settings.account.passwordMismatch": "New passwords don't match",
    "settings.account.changeFailed": "Failed to change the password",
    "settings.account.changed": "Password changed",
    "settings.account.changePassword": "Change password",

    "settings.account.totp.title": "Two-factor authentication (2FA)",
    "settings.account.totp.statusOn": "Enabled",
    "settings.account.totp.statusOff": "Disabled — a password alone is enough to sign in",
    "settings.account.totp.enableButton": "Enable 2FA",
    "settings.account.totp.enableTitle": "Enable 2FA",
    "settings.account.totp.enableDescription":
      "Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.) or enter the secret manually, then confirm with a code from the app.",
    "settings.account.totp.setupFailed": "Failed to generate a secret",
    "settings.account.totp.codeLabel": "Code from the app",
    "settings.account.totp.confirmButton": "Confirm and enable",
    "settings.account.totp.confirmFailed": "Failed to confirm the code",
    "settings.account.totp.disableButton": "Disable 2FA",
    "settings.account.totp.disableTitle": "Disable 2FA",
    "settings.account.totp.disableDescription": "Enter the current code from the app to confirm disabling it.",
    "settings.account.totp.disableFailed": "Failed to disable 2FA",

    "settings.network.title": "Panel network",
    "settings.network.description":
      "Saved immediately, but only takes effect after the panel restarts — the process reads these settings once at startup",
    "settings.network.insecureWarning":
      "You're viewing the panel over plain http — your password and auth token are being sent unencrypted. Set up a TLS certificate below (or SSL on a reverse proxy in front of the panel), then open the panel over https.",
    "settings.network.saveFailed": "Failed to save",
    "settings.network.restartConfirm":
      "Restart the panel? Every kernel process (Turnable/olcRTC/FreeTurn/WebDAV) will be stopped and brought back up — active calls will drop for a couple of seconds.",
    "settings.network.restartButton": "Restart panel",
    "settings.network.restartFailed": "Failed to start the restart",
    "settings.network.restartDialogTitle": "Restarting the panel",
    "settings.network.restartDialogMessage":
      "The panel is restarting — this page will move to the new address itself if the domain/port/URI path changed.",
    "settings.network.publicIpLabel": "Public IP/host of the VPS",
    "settings.network.publicIpPlaceholder": "Auto-detected on first start",
    "settings.network.publicIpHelp":
      "Baked into Turnable/FreeTurn client configs — auto-detected on first install, but can get it wrong (multiple network interfaces, NAT, IPv6-only). An empty value is why Turnable fails with \"public_ip is required\".",
    "settings.network.webdavPublicHostLabel": "Public host for WebDAV",
    "settings.network.webdavPublicHostPlaceholder": "Empty — use the public IP above",
    "settings.network.webdavPublicHostHelp":
      "The host WebDAV profile clients are given. Set this if WebDAV needs a domain rather than a bare IP — e.g. if the panel's certificate was issued for a domain.",
    "settings.network.listenIpLabel": "IP address to manage the panel on",
    "settings.network.listenIpPlaceholder": "Leave empty to allow any IP",
    "settings.network.listenDomainLabel": "Panel domain",
    "settings.network.listenDomainPlaceholder": "Leave empty to allow any domain or IP",
    "settings.network.listenPortLabel": "Panel port",
    "settings.network.listenPortPlaceholder": "Default",
    "settings.network.listenPortHelp": "The port the panel runs on",
    "settings.network.basePathLabel": "URI path",
    "settings.network.basePathHelp": "Must start and end with '/'",
    "settings.network.tlsCertLabel": "Path to the panel's TLS certificate (public key) file",
    "settings.network.tlsKeyLabel": "Path to the panel's TLS private key file",
    "settings.network.pathPlaceholder": "Enter the full path, starting with '/'",
    "settings.network.saved": "Saved — restart the panel for the changes to take effect",

    "settings.restartDialog.timedOut":
      "The panel is taking longer than usual to restart, or the new address isn't responding. If the IP/domain/port changed, open the panel at the new address manually. Check on the server: journalctl -u wt-panel.",

    "settings.update.title": "Panel update",
    "settings.update.description": "Update wt-panel from GitHub Releases",
    "settings.update.checkFailed": "Failed to check for updates",
    "settings.update.confirm":
      "Update the panel? Every kernel process (Turnable/olcRTC/FreeTurn/WebDAV) will be stopped and brought back up — active calls will drop for a couple of seconds.",
    "settings.update.button": "Update",
    "settings.update.startFailed": "Failed to start the update",
    "settings.update.dialogTitle": "Updating the panel",
    "settings.update.dialogMessage":
      "Downloading the new version and restarting the panel — this page will refresh itself once the new version is up.",
    "settings.update.devBuild": "Unavailable — this build was compiled from source (dev), not a release.",
    "settings.update.currentVersion": "Current version:",
    "settings.update.versionAvailable": "Version available:",
    "settings.update.upToDate": "Already on the latest version",
    "settings.update.checking": "Checking...",
    "settings.update.check": "Check for updates",

    "settings.backup.title": "Backup",
    "settings.backup.description":
      "A full snapshot of the panel (settings, every client and profile, xray inbounds, the admin account) as a single file — for recovering after reinstalling or moving to a different VPS",
    "settings.backup.downloadButton": "Download backup (.db)",
    "settings.backup.downloadFailed": "Failed to download the backup",
    "settings.backup.restoreButton": "Restore from backup",
    "settings.backup.restoreNetworkSettingsLabel": "Also restore network settings from the backup",
    "settings.backup.restoreNetworkSettingsOffHint":
      "Off (recommended when moving to a different VPS) — IP, domain, port, and TLS certificate paths stay as they are now, not the backup's.",
    "settings.backup.restoreNetworkSettingsOnHint":
      "On — IP, domain, port, and TLS certificate paths will also be replaced with the backup's values. Only makes sense when restoring onto the same machine the backup was taken on.",
    "settings.backup.restoreConfirm":
      "Restore the panel from this file? Every current client, profile, inbound, and the admin account (including its password and 2FA) will be permanently replaced with the backup's contents. This machine's network settings (IP/domain/SSL) will stay as they are. The panel will restart.",
    "settings.backup.restoreConfirmWithNetwork":
      "Restore the panel from this file? Every current client, profile, inbound, the admin account (including its password and 2FA), AND network settings (IP/domain/TLS certificate paths) will be permanently replaced with the backup's contents. The panel will restart.",
    "settings.backup.restoreFailed": "Failed to restore from the backup",
    "settings.backup.restoreDialogTitle": "Restoring from backup",
    "settings.backup.restoreDialogMessage":
      "Replacing the panel's database and restarting — this page will refresh itself once the panel is back.",

    "settings.config.title": "Panel configuration",
    "settings.config.description":
      "Read-only — set via environment variables (see README); restart the panel to change these",

    "settings.label.listenAddr": "Panel address",
    "settings.label.publicOrigin": "Public origin (for subscription links)",
    "settings.label.dataDir": "Data directory",
    "settings.label.turnableBinPath": "Turnable binary",
    "settings.label.olcrtcBinPath": "olcRTC binary",
    "settings.label.webdavBinPath": "WebDAV binary",
    "settings.label.freeturnBinPath": "FreeTurn binary",
    "settings.label.turnableListenHost": "Turnable — listen interface",
    "settings.label.freeturnListenHost": "FreeTurn — listen interface",
    "settings.label.webdavListenHost": "WebDAV — listen interface",
    "settings.label.turnableDefaultRouteHost": "Turnable — default route host",
    "settings.label.freeturnDefaultConnectHost": "FreeTurn — default -connect host",
    "settings.label.webdavDefaultProxyUpstream": "WebDAV — default upstream proxy",
    "settings.label.webdavPublicHost": "WebDAV — public host",
  },
}
