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

    "settings.network.title": "Сеть панели",
    "settings.network.description":
      "Сохраняется сразу, но применяется только после перезапуска панели — процесс читает эти настройки один раз при старте",
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

    "settings.network.title": "Panel network",
    "settings.network.description":
      "Saved immediately, but only takes effect after the panel restarts — the process reads these settings once at startup",
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
