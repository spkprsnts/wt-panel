import * as React from "react"
import { Loader2 } from "lucide-react"

import { api } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const SETTINGS_LABELS: Record<string, string> = {
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
  const { confirm } = useDialogPrompt()
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
  const [beforeBootId, setBeforeBootId] = React.useState<string | null>(null)

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
      !(await confirm(
        "Перезапустить панель? Все процессы ядер (Turnable/olcRTC/FreeTurn/WebDAV) будут остановлены и подняты заново — активные звонки на пару секунд прервутся.",
        { destructive: true, confirmLabel: "Перезапустить" }
      ))
    ) {
      return
    }
    setError(null)
    try {
      const before = await api.getSettings()
      await api.restartPanel()
      setBeforeBootId(before.bootId)
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
        <PanelRestartDialog
          open={restarting}
          beforeBootId={beforeBootId}
          title="Перезапуск панели"
          message="Панель перезапускается — эта страница обновится сама. Если менялись IP/домен/порт/URI-путь, откройте её по новому адресу вручную, когда она снова будет доступна."
        />
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
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

// restartPollIntervalMs/restartPollMaxAttempts govern how PanelRestartDialog
// waits for the panel to come back after triggering a restart — a plain
// "Перезапустить панель" or a self-update, both of which end the same way
// (see restartPanel/updatePanel + relaunchSelf's syscall.Exec). This
// compares /api/settings' bootId against beforeBootId (captured right
// before the action was triggered) rather than just waiting for a request
// to fail once — a "the panel went briefly unreachable, then answered
// again" check sounds right but isn't reliable in practice: the backend's
// own down-window (a short delay, then a graceful shutdown/re-exec) can
// finish faster than this poll's own interval, so a real restart can
// complete without a single poll ever landing during the gap — confirmed
// for real: the "wait for one failure" version of this never reloaded at
// all. version can't fill this role either — it doesn't change across a
// plain restart, only across an update — which is exactly why bootId
// exists: a fresh random value generated once per process (see
// Server.bootID), so any actual process restart changes it, update or not.
const restartPollIntervalMs = 2000
const restartPollMaxAttempts = 60 // ~2 minutes

function PanelRestartDialog({
  open,
  beforeBootId,
  title,
  message,
}: {
  open: boolean
  beforeBootId: string | null
  title: string
  message: string
}) {
  const [timedOut, setTimedOut] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setTimedOut(false)
    let cancelled = false
    let attempts = 0
    let timer: number

    const poll = () => {
      api
        .getSettings()
        .then((s) => {
          if (cancelled) return
          if (beforeBootId !== null && s.bootId !== beforeBootId) {
            window.location.reload()
            return
          }
          scheduleNext()
        })
        .catch(() => {
          if (cancelled) return
          scheduleNext()
        })
    }
    const scheduleNext = () => {
      attempts += 1
      if (attempts >= restartPollMaxAttempts) {
        setTimedOut(true)
        return
      }
      timer = window.setTimeout(poll, restartPollIntervalMs)
    }
    poll()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, beforeBootId])

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {timedOut ? (
          <p className="text-sm text-destructive">
            Панель дольше обычного не перезапускается — либо она не отвечает, либо изменения не
            применились (например, сменился IP/домен/порт панели — тогда откройте её по новому
            адресу). Проверьте на сервере: journalctl -u wt-panel.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-center text-sm text-muted-foreground">{message}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PanelUpdateCard() {
  const { confirm } = useDialogPrompt()
  const [version, setVersion] = React.useState<string | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [updating, setUpdating] = React.useState(false)
  const [beforeBootId, setBeforeBootId] = React.useState<string | null>(null)
  const [latestVersion, setLatestVersion] = React.useState<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    api
      .getSettings()
      .then((s) => setVersion(s.version))
      .catch(() => {})
  }, [])

  async function handleCheck() {
    setError(null)
    setChecking(true)
    setLatestVersion(null)
    try {
      const res = await api.checkPanelUpdate()
      setLatestVersion(res.latestVersion)
      setUpdateAvailable(res.updateAvailable)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось проверить обновления")
    } finally {
      setChecking(false)
    }
  }

  async function handleUpdate() {
    if (
      !(await confirm(
        "Обновить панель? Все процессы ядер (Turnable/olcRTC/FreeTurn/WebDAV) будут остановлены и подняты заново — активные звонки на пару секунд прервутся.",
        { destructive: true, confirmLabel: "Обновить" }
      ))
    ) {
      return
    }
    setError(null)
    try {
      const before = await api.getSettings()
      await api.updatePanel()
      setBeforeBootId(before.bootId)
      setUpdating(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить обновление")
    }
  }

  const isDev = version === "dev"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Обновление панели</CardTitle>
        <CardDescription>Проверка и установка новой версии wt-panel с GitHub Releases</CardDescription>
      </CardHeader>
      <CardContent>
        <PanelRestartDialog
          open={updating}
          beforeBootId={beforeBootId}
          title="Обновление панели"
          message="Скачиваем новую версию и перезапускаем панель — эта страница обновится сама, как только новая версия окажется доступна."
        />
        {isDev ? (
          <p className="text-sm text-muted-foreground">
            Недоступно — эта сборка запущена из исходников (dev), а не из релиза.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Текущая версия: <span className="font-mono">{version ?? "..."}</span>
            </p>
            {latestVersion !== null && (
              <p className="text-sm">
                {updateAvailable ? (
                  <>
                    Доступна версия <span className="font-mono">v{latestVersion}</span>
                  </>
                ) : (
                  "Установлена последняя версия"
                )}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleCheck} disabled={checking}>
                {checking ? "Проверяем..." : "Проверить обновления"}
              </Button>
              {updateAvailable && (
                <Button type="button" onClick={handleUpdate}>
                  Обновить
                </Button>
              )}
            </div>
          </div>
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
            {Object.entries(settings)
              .filter(([key]) => key !== "version" && key !== "bootId")
              .map(([key, value]) => (
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
        <PanelUpdateCard />
        <ConfigCard />
      </div>
    </div>
  )
}
