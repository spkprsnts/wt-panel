import * as React from "react"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const SETTINGS_LABELS: Record<string, string> = {
  version: "Версия",
  listenAddr: "Адрес панели",
  publicOrigin: "Публичный origin (для ссылок подписки)",
  publicIP: "Публичный IP/хост VPS",
  dataDir: "Каталог данных",
  turnableBinPath: "Бинарник Turnable",
  olcrtcBinPath: "Бинарник olcRTC",
  webdavBinPath: "Бинарник WebDAV",
  freeturnBinPath: "Бинарник FreeTurn",
  turnableListenHost: "Turnable — интерфейс прослушивания",
  freeturnListenHost: "FreeTurn — интерфейс прослушивания",
  webdavListenHost: "WebDAV — интерфейс прослушивания",
  turnableDefaultRouteHost: "Turnable — хост маршрута по умолчанию",
  freeturnDefaultConnectHost: "FreeTurn — хост -connect по умолчанию",
  webdavDefaultProxyUpstream: "WebDAV — upstream-прокси по умолчанию",
  webdavPublicHost: "WebDAV — публичный хост",
}

function AccountCard() {
  const [username, setUsername] = React.useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)

  React.useEffect(() => {
    api.getAccount().then((a) => setUsername(a.username)).catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword !== confirmPassword) {
      setError("Новые пароли не совпадают")
      return
    }
    setLoading(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setSuccess(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Аккаунт</CardTitle>
        <CardDescription>{username ? `Вход выполнен как ${username}` : "Загрузка..."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="current-password">Текущий пароль</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">Новый пароль</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">Повторите новый пароль</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-green-600">Пароль изменён</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Сохраняем..." : "Сменить пароль"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PanelNetworkCard() {
  const [listenIp, setListenIp] = React.useState("")
  const [listenDomain, setListenDomain] = React.useState("")
  const [listenPort, setListenPort] = React.useState("")
  const [basePath, setBasePath] = React.useState("/")
  const [tlsCertFile, setTlsCertFile] = React.useState("")
  const [tlsKeyFile, setTlsKeyFile] = React.useState("")
  const [publicIp, setPublicIp] = React.useState("")
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)

  React.useEffect(() => {
    api
      .getPanelSettings()
      .then((s) => {
        setListenIp(s.ListenIP)
        setListenDomain(s.ListenDomain)
        setListenPort(s.ListenPort ? String(s.ListenPort) : "")
        setBasePath(s.BasePath || "/")
        setTlsCertFile(s.TLSCertFile)
        setTlsKeyFile(s.TLSKeyFile)
        setPublicIp(s.PublicIP)
      })
      .finally(() => setLoaded(true))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setLoading(true)
    try {
      await api.updatePanelSettings({
        listenIp,
        listenDomain,
        listenPort: Number(listenPort) || 0,
        basePath,
        tlsCertFile,
        tlsKeyFile,
        publicIp,
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить")
    } finally {
      setLoading(false)
    }
  }

  async function handleRestart() {
    if (
      !confirm(
        "Перезапустить панель? Все процессы ядер (Turnable/olcRTC/FreeTurn/WebDAV) будут остановлены и подняты заново — активные звонки на пару секунд прервутся."
      )
    ) {
      return
    }
    setError(null)
    try {
      await api.restartPanel()
      setRestarting(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить перезапуск")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Сеть панели</CardTitle>
        <CardDescription>
          Сохраняется сразу, но применяется только после перезапуска панели — процесс читает эти
          настройки один раз при старте
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : restarting ? (
          <p className="text-sm text-muted-foreground">
            Панель перезапускается — если менялись IP/домен/порт/URI-путь, откройте её по новому
            адресу через несколько секунд.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="panel-public-ip">Публичный IP/хост VPS</Label>
              <Input
                id="panel-public-ip"
                value={publicIp}
                onChange={(e) => setPublicIp(e.target.value)}
                placeholder="Автоматически определяется при первом запуске"
              />
              <p className="text-xs text-muted-foreground">
                Зашивается в конфиг клиентов Turnable/FreeTurn — определяется автоматически при
                первой установке панели, но может ошибиться (несколько сетевых интерфейсов, NAT,
                IPv6-only). Пустое значение — причина ошибки Turnable &quot;public_ip is
                required&quot;.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="panel-listen-ip">IP-адрес для управления панелью</Label>
              <Input id="panel-listen-ip" value={listenIp} onChange={(e) => setListenIp(e.target.value)} placeholder="Оставьте пустым для подключения с любого IP" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="panel-listen-domain">Домен панели</Label>
              <Input
                id="panel-listen-domain"
                value={listenDomain}
                onChange={(e) => setListenDomain(e.target.value)}
                placeholder="Оставьте пустым для подключения с любых доменов и IP"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="panel-listen-port">Порт панели</Label>
              <Input id="panel-listen-port" type="number" value={listenPort} onChange={(e) => setListenPort(e.target.value)} placeholder="По умолчанию" />
              <p className="text-xs text-muted-foreground">Порт, на котором работает панель</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="panel-base-path">URI-путь</Label>
              <Input id="panel-base-path" value={basePath} onChange={(e) => setBasePath(e.target.value)} required />
              <p className="text-xs text-muted-foreground">Должен начинаться с &apos;/&apos; и заканчиваться &apos;/&apos;</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="panel-tls-cert">Путь к файлу публичного ключа сертификата панели</Label>
              <Input id="panel-tls-cert" value={tlsCertFile} onChange={(e) => setTlsCertFile(e.target.value)} placeholder="Введите полный путь, начинающийся с '/'" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="panel-tls-key">Путь к файлу приватного ключа сертификата панели</Label>
              <Input id="panel-tls-key" value={tlsKeyFile} onChange={(e) => setTlsKeyFile(e.target.value)} placeholder="Введите полный путь, начинающийся с '/'" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && <p className="text-sm text-green-600">Сохранено — перезапустите панель, чтобы изменения вступили в силу</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Сохраняем..." : "Сохранить"}
              </Button>
              <Button type="button" variant="destructive" onClick={handleRestart}>
                Перезапустить панель
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function ConfigCard() {
  const [settings, setSettings] = React.useState<Record<string, string> | null>(null)

  React.useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Конфигурация панели</CardTitle>
        <CardDescription>
          Только для чтения — задаётся через переменные окружения (см. README),
          для изменения нужно перезапустить панель
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings === null ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            {Object.entries(settings).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-4 border-b py-1.5 last:border-0">
                <span className="text-muted-foreground">{SETTINGS_LABELS[key] ?? key}</span>
                <span className="truncate font-mono text-xs">{value || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Настройки</h1>
      <div className="flex flex-col gap-6">
        <AccountCard />
        <PanelNetworkCard />
        <ConfigCard />
      </div>
    </div>
  )
}
