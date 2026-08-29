import * as React from "react"

import { api } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
import { useT } from "@/lib/i18n"
import type { TranslationKey } from "@/i18n"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { SectionGroup, SectionItem, LabelGroup, SwitchRow, TextFieldRow } from "@/components/ui/section"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const SETTINGS_LABEL_KEYS: Record<string, TranslationKey> = {
  listenAddr: "settings.label.listenAddr",
  publicOrigin: "settings.label.publicOrigin",
  publicIP: "settings.network.publicIpLabel",
  dataDir: "settings.label.dataDir",
  turnableBinPath: "settings.label.turnableBinPath",
  olcrtcBinPath: "settings.label.olcrtcBinPath",
  webdavBinPath: "settings.label.webdavBinPath",
  freeturnBinPath: "settings.label.freeturnBinPath",
  turnableListenHost: "settings.label.turnableListenHost",
  freeturnListenHost: "settings.label.freeturnListenHost",
  webdavListenHost: "settings.label.webdavListenHost",
  turnableDefaultRouteHost: "settings.label.turnableDefaultRouteHost",
  freeturnDefaultConnectHost: "settings.label.freeturnDefaultConnectHost",
  webdavDefaultProxyUpstream: "settings.label.webdavDefaultProxyUpstream",
  olcrtcDefaultProxyUpstream: "settings.label.olcrtcDefaultProxyUpstream",
  webdavPublicHost: "settings.label.webdavPublicHost",
}

// TotpEnableDialog walks the operator through 3x-ui-style 2FA setup: scan a
// QR (or type the secret manually), then prove the authenticator app is
// actually wired up correctly by entering one real code before anything
// gets saved — see startTotpSetup/confirmTotpSetup's own doc comments for
// why the secret is never persisted before that proof.
function TotpEnableDialog({ onEnabled }: { onEnabled: () => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [secret, setSecret] = React.useState("")
  const [qrDataUri, setQrDataUri] = React.useState("")
  const [code, setCode] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [confirmError, setConfirmError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setCode("")
    setConfirmError(null)
    setLoadError(null)
    api
      .startTotpSetup()
      .then((res) => {
        setSecret(res.secret)
        setQrDataUri(res.qrDataUri)
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : t("settings.account.totp.setupFailed")))
  }, [open, t])

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    setConfirmError(null)
    setLoading(true)
    try {
      await api.confirmTotpSetup(secret, code)
      setOpen(false)
      onEnabled()
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : t("settings.account.totp.confirmFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            {t("settings.account.totp.enableButton")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("settings.account.totp.enableTitle")}</DialogTitle>
          <DialogDescription>{t("settings.account.totp.enableDescription")}</DialogDescription>
        </DialogHeader>
        {loadError && <p className="text-sm text-error">{loadError}</p>}
        {!loadError && !qrDataUri && <p className="text-sm text-on-surface-variant">{t("common.loading")}</p>}
        {qrDataUri && (
          <form onSubmit={handleConfirm} className="flex flex-col gap-3">
            <img src={qrDataUri} alt="QR" className="mx-auto size-48 rounded-md border p-2" />
            <code className="break-all rounded-md border bg-surface-variant p-2 text-center text-xs">{secret}</code>
            <div className="flex flex-col gap-2">
              <Label htmlFor="totp-confirm-code">{t("settings.account.totp.codeLabel")}</Label>
              <Input
                id="totp-confirm-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </div>
            {confirmError && <p className="text-sm text-error">{confirmError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={loading}>
                {loading ? t("common.saving") : t("settings.account.totp.confirmButton")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// TotpDisableDialog requires one more valid code before turning 2FA off —
// mirrors disableTotp's own requirement on the backend, so losing access to
// the authenticator app isn't itself a reason 2FA can be switched off (a
// stolen bearer token alone isn't enough).
function TotpDisableDialog({ onDisabled }: { onDisabled: () => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [code, setCode] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setCode("")
      setError(null)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.disableTotp(code)
      setOpen(false)
      onDisabled()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.account.totp.disableFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="destructive">
            {t("settings.account.totp.disableButton")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("settings.account.totp.disableTitle")}</DialogTitle>
          <DialogDescription>{t("settings.account.totp.disableDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="totp-disable-code">{t("settings.account.totp.codeLabel")}</Label>
            <Input
              id="totp-disable-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={loading}>
              {loading ? t("common.saving") : t("settings.account.totp.disableButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AccountCard() {
  const t = useT()
  const [username, setUsername] = React.useState<string | null>(null)
  const [totpEnabled, setTotpEnabled] = React.useState(false)
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)

  function loadAccount() {
    api
      .getAccount()
      .then((a) => {
        setUsername(a.username)
        setTotpEnabled(a.totpEnabled)
      })
      .catch(() => {})
  }

  React.useEffect(loadAccount, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword !== confirmPassword) {
      setError(t("settings.account.passwordMismatch"))
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
      setError(err instanceof Error ? err.message : t("settings.account.changeFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <CardTitle>{t("settings.account.title")}</CardTitle>
        <CardDescription>
          {username ? `${t("settings.account.loggedInAs")} ${username}` : t("common.loading")}
        </CardDescription>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <SectionGroup>
          <SectionItem position="top">
            <TextFieldRow
              label={t("settings.account.currentPassword")}
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              required
            />
          </SectionItem>
          <SectionItem position="middle">
            <TextFieldRow
              label={t("settings.account.newPassword")}
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              required
              minLength={8}
            />
          </SectionItem>
          <SectionItem position="bottom">
            <TextFieldRow
              label={t("settings.account.confirmPassword")}
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              required
            />
          </SectionItem>
        </SectionGroup>
        {error && <p className="text-sm text-error">{error}</p>}
        {success && <p className="text-sm text-green-600">{t("settings.account.changed")}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? t("common.saving") : t("settings.account.changePassword")}
        </Button>
      </form>

      <SectionGroup className="max-w-lg">
        <SectionItem position="single">
          <div className="flex w-full items-center justify-between gap-3">
            <LabelGroup
              label={t("settings.account.totp.title")}
              supportingText={totpEnabled ? t("settings.account.totp.statusOn") : t("settings.account.totp.statusOff")}
            />
            {totpEnabled ? (
              <TotpDisableDialog onDisabled={loadAccount} />
            ) : (
              <TotpEnableDialog onEnabled={loadAccount} />
            )}
          </div>
        </SectionItem>
      </SectionGroup>
    </div>
  )
}

// buildTargetUrl guesses the address the panel will actually be reachable
// at once a network-settings restart completes, from whatever's currently
// filled into PanelNetworkCard's own form — so PanelRestartDialog can
// navigate the browser there directly instead of just reloading whatever
// URL happens to be open right now (which 404s the instant the operator
// changes the base path, and simply stops responding at all the instant
// they change the domain or port — see PanelRestartDialog's own comment).
// Best-effort by design: anything left blank/unchanged falls back to
// window.location's own current value, since that's still correct unless
// the operator actually edited that particular field.
function buildTargetUrl(opts: {
  listenDomain: string
  listenPort: string
  publicIp: string
  basePath: string
  hasTls: boolean
}): string {
  const scheme = opts.hasTls ? "https" : "http"
  const host = opts.listenDomain || opts.publicIp || window.location.hostname
  const port = Number(opts.listenPort) || Number(window.location.port) || 8090
  const path = opts.basePath || "/"
  return `${scheme}://${host}:${port}${path}`
}

// isInsecureConnection reads the BROWSER's own address bar, not
// PanelSettings.TLSCertFile — deliberately: this page's TLS cert fields
// only describe whether the Go panel process itself terminates TLS, but a
// perfectly common deployment puts nginx (or another reverse proxy) in
// front of the panel doing the TLS termination itself, leaving the panel's
// own listener on plain http behind it. Checking TLSCertFile there would
// wrongly flag that setup as insecure even though the browser's actual
// connection is https all the way. window.location.protocol reflects
// reality regardless of which layer terminated TLS. localhost/127.0.0.1/
// ::1 are excluded — loopback (or an SSH tunnel terminating there) isn't
// exposed to the same interception risk plain http over a real network is.
function isInsecureConnection(): boolean {
  if (typeof window === "undefined") return false
  if (window.location.protocol === "https:") return false
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
}

function PanelNetworkCard() {
  const t = useT()
  const { confirm } = useDialogPrompt()
  const [listenIp, setListenIp] = React.useState("")
  const [listenDomain, setListenDomain] = React.useState("")
  const [listenPort, setListenPort] = React.useState("")
  const [basePath, setBasePath] = React.useState("/")
  const [tlsCertFile, setTlsCertFile] = React.useState("")
  const [tlsKeyFile, setTlsKeyFile] = React.useState("")
  const [publicIp, setPublicIp] = React.useState("")
  const [webdavPublicHost, setWebdavPublicHost] = React.useState("")
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)
  const [restarting, setRestarting] = React.useState(false)
  const [beforeBootId, setBeforeBootId] = React.useState<string | null>(null)
  const [targetUrl, setTargetUrl] = React.useState<string | null>(null)

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
        setWebdavPublicHost(s.WebDAVPublicHost)
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
        webdavPublicHost,
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.network.saveFailed"))
    } finally {
      setLoading(false)
    }
  }

  async function handleRestart() {
    if (
      !(await confirm(t("settings.network.restartConfirm"), {
        destructive: true,
        confirmLabel: t("settings.network.restartButton"),
      }))
    ) {
      return
    }
    setError(null)
    try {
      const before = await api.getSettings()
      await api.restartPanel()
      setBeforeBootId(before.bootId)
      setTargetUrl(
        buildTargetUrl({
          listenDomain,
          listenPort,
          publicIp,
          basePath,
          hasTls: !!tlsCertFile && !!tlsKeyFile,
        })
      )
      setRestarting(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.network.restartFailed"))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <CardTitle>{t("settings.network.title")}</CardTitle>
        <CardDescription>{t("settings.network.description")}</CardDescription>
      </div>
      {isInsecureConnection() && (
        <div className="flex items-start gap-2 rounded-md border border-error/50 bg-error/10 p-3 text-sm text-error">
          <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
          <span>{t("settings.network.insecureWarning")}</span>
        </div>
      )}
      <PanelRestartDialog
        open={restarting}
        beforeBootId={beforeBootId}
        title={t("settings.network.restartDialogTitle")}
        message={t("settings.network.restartDialogMessage")}
        targetUrl={targetUrl}
      />
      {!loaded ? (
        <p className="text-sm text-on-surface-variant">{t("common.loading")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <SectionGroup>
            <SectionItem position="top">
              <TextFieldRow
                label={t("settings.network.publicIpLabel")}
                value={publicIp}
                onChange={setPublicIp}
                placeholder={t("settings.network.publicIpPlaceholder")}
                supportingText={t("settings.network.publicIpHelp")}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("settings.network.webdavPublicHostLabel")}
                value={webdavPublicHost}
                onChange={setWebdavPublicHost}
                placeholder={t("settings.network.webdavPublicHostPlaceholder")}
                supportingText={t("settings.network.webdavPublicHostHelp")}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("settings.network.listenIpLabel")}
                value={listenIp}
                onChange={setListenIp}
                supportingText={t("settings.network.listenIpPlaceholder")}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("settings.network.listenDomainLabel")}
                value={listenDomain}
                onChange={setListenDomain}
                supportingText={t("settings.network.listenDomainPlaceholder")}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("settings.network.listenPortLabel")}
                type="number"
                value={listenPort}
                onChange={setListenPort}
                placeholder={t("settings.network.listenPortPlaceholder")}
                supportingText={t("settings.network.listenPortHelp")}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("settings.network.basePathLabel")}
                value={basePath}
                onChange={setBasePath}
                required
                supportingText={t("settings.network.basePathHelp")}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("settings.network.tlsCertLabel")}
                value={tlsCertFile}
                onChange={setTlsCertFile}
                placeholder={t("settings.network.pathPlaceholder")}
              />
            </SectionItem>
            <SectionItem position="bottom">
              <TextFieldRow
                label={t("settings.network.tlsKeyLabel")}
                value={tlsKeyFile}
                onChange={setTlsKeyFile}
                placeholder={t("settings.network.pathPlaceholder")}
              />
            </SectionItem>
          </SectionGroup>
          {error && <p className="text-sm text-error">{error}</p>}
          {saved && <p className="text-sm text-green-600">{t("settings.network.saved")}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={loading}>
              {loading ? t("common.saving") : t("common.save")}
            </Button>
            <Button type="button" variant="destructive" onClick={handleRestart}>
              {t("settings.network.restartButton")}
            </Button>
          </div>
        </form>
      )}
    </div>
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
// ~7 minutes worst case, not ~2: each attempt can take up to
// restartPollTimeoutMs (5s) before the interval delay even starts, so the
// true bound is maxAttempts * (intervalMs + timeoutMs) = 60 * 7s.
const restartPollMaxAttempts = 60
// restartPollTimeoutMs bounds each individual poll request — a self-restart
// (syscall.Exec swapping the process image) can leave whichever request
// happens to be in flight at that exact moment neither resolving nor
// rejecting on its own; without a hard per-request timeout, that single
// hung request wedges the whole recursive poll chain forever (scheduleNext
// only ever runs from this promise's own .then()/.catch()) — confirmed for
// real: an update got stuck on an infinite spinner with a pile of pending
// /api/settings requests in devtools, never timing out and never reloading.
const restartPollTimeoutMs = 5000

function PanelRestartDialog({
  open,
  beforeBootId,
  title,
  message,
  targetUrl,
}: {
  open: boolean
  beforeBootId: string | null
  title: string
  message: string
  // Where to send the browser once the panel is confirmed back up —
  // PanelNetworkCard's restart passes its best guess at the post-restart
  // address (see buildTargetUrl); everything else (a plain "Update panel"
  // restart, which never touches network settings) leaves this unset and
  // gets the old reload-in-place behavior.
  targetUrl?: string | null
}) {
  const t = useT()
  const [timedOut, setTimedOut] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setTimedOut(false)
    let cancelled = false
    let attempts = 0
    let timer: number

    // crossOrigin is true when the operator changed the panel's own
    // domain/port as part of this restart — the browser is currently
    // pointed at the OLD address, and the moment the new process rebinds
    // elsewhere, that old address stops answering *permanently*, not just
    // during the restart window (see the bootId comment below for the
    // same-origin case, which this is deliberately not). Polling it with
    // the usual same-origin bootId comparison would just spin until
    // restartPollMaxAttempts and give up. A `no-cors` fetch of the NEW
    // address instead only asks "does anything answer here yet" — the
    // browser refuses to expose the response body cross-origin, but the
    // promise still resolves the instant a real HTTP response comes back
    // and rejects on connection-refused/timeout/TLS failure, which is
    // exactly the yes/no this needs. A top-level navigation afterward
    // (unlike fetch/XHR) is never CORS-restricted, so redirecting there is
    // safe even though reading it first wasn't an option.
    const crossOrigin = !!targetUrl && new URL(targetUrl, window.location.href).origin !== window.location.origin

    const poll = () => {
      if (crossOrigin) {
        const controller = new AbortController()
        const abortTimer = window.setTimeout(() => controller.abort(), restartPollTimeoutMs)
        fetch(targetUrl!, { mode: "no-cors", cache: "no-store", signal: controller.signal })
          .then(() => {
            window.clearTimeout(abortTimer)
            if (cancelled) return
            window.location.href = targetUrl!
          })
          .catch(() => {
            window.clearTimeout(abortTimer)
            if (cancelled) return
            scheduleNext()
          })
        return
      }
      api
        .getSettings(restartPollTimeoutMs)
        .then((s) => {
          if (cancelled) return
          if (beforeBootId !== null && s.bootId !== beforeBootId) {
            if (targetUrl) window.location.href = targetUrl
            else window.location.reload()
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
  }, [open, beforeBootId, targetUrl])

  return (
    <Dialog
      open={open}
      onOpenChange={(_open, eventDetails) => {
        if (eventDetails.reason === "escape-key") {
          eventDetails.cancel()
        }
      }}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {timedOut ? (
          <p className="text-sm text-error">{t("settings.restartDialog.timedOut")}</p>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            <Icon name="progress_activity" size={32} className="animate-spin text-on-surface-variant" />
            <p className="text-center text-sm text-on-surface-variant">{message}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PanelUpdateCard() {
  const t = useT()
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
      setError(err instanceof Error ? err.message : t("settings.update.checkFailed"))
    } finally {
      setChecking(false)
    }
  }

  async function handleUpdate() {
    if (
      !(await confirm(t("settings.update.confirm"), {
        destructive: true,
        confirmLabel: t("settings.update.button"),
      }))
    ) {
      return
    }
    setError(null)
    // Open the blocking dialog before the network calls below, not after —
    // updatePanel() downloads and installs the release synchronously on the
    // backend before responding (see its own doc comment), so awaiting it
    // first left a multi-second gap between confirming and any dialog
    // showing up at all.
    setUpdating(true)
    try {
      const before = await api.getSettings()
      setBeforeBootId(before.bootId)
      await api.updatePanel()
    } catch (err) {
      setUpdating(false)
      setError(err instanceof Error ? err.message : t("settings.update.startFailed"))
    }
  }

  const isDev = version === "dev"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <CardTitle>{t("settings.update.title")}</CardTitle>
        <CardDescription>{t("settings.update.description")}</CardDescription>
      </div>
      <PanelRestartDialog
        open={updating}
        beforeBootId={beforeBootId}
        title={t("settings.update.dialogTitle")}
        message={t("settings.update.dialogMessage")}
      />
      {isDev ? (
        <p className="text-sm text-on-surface-variant">{t("settings.update.devBuild")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-on-surface-variant">
            {t("settings.update.currentVersion")} <span className="font-mono">{version ?? "..."}</span>
          </p>
          {latestVersion !== null && (
            <p className="text-sm">
              {updateAvailable ? (
                <>
                  {t("settings.update.versionAvailable")} <span className="font-mono">v{latestVersion}</span>
                </>
              ) : (
                t("settings.update.upToDate")
              )}
            </p>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleCheck} disabled={checking}>
              {checking ? t("settings.update.checking") : t("settings.update.check")}
            </Button>
            {updateAvailable && (
              <Button type="button" onClick={handleUpdate}>
                {t("settings.update.button")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// PanelBackupCard is the "download everything / restore everything"
// counterpart to the per-client profile exports elsewhere in the app —
// mirrors 3x-ui's own Backup section. Restore is maximally destructive (the
// entire live database, admin account included, gets replaced — see
// restorePanelBackup's own doc comment), so it goes through confirm() with
// destructive:true and names exactly what's about to happen, same
// confirmation weight as PanelUpdateCard's own update button.
function PanelBackupCard() {
  const t = useT()
  const { confirm } = useDialogPrompt()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [restoring, setRestoring] = React.useState(false)
  const [beforeBootId, setBeforeBootId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // Off by default: the realistic case is restoring a backup taken on a
  // DIFFERENT VPS onto one install.sh already set up with its own correct
  // IP/domain/SSL — applying the backup's network settings on top would
  // just replace that with the old, now-wrong machine's identity. Turning
  // it on is for the same-machine case (undoing a mistake, rolling back).
  const [restoreNetworkSettings, setRestoreNetworkSettings] = React.useState(false)

  async function handleDownload() {
    setError(null)
    setDownloading(true)
    try {
      await api.downloadPanelBackup()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.backup.downloadFailed"))
    } finally {
      setDownloading(false)
    }
  }

  function handlePickFile() {
    fileInputRef.current?.click()
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // so picking the exact same file again still fires onChange
    if (!file) return

    if (
      !(await confirm(
        restoreNetworkSettings
          ? t("settings.backup.restoreConfirmWithNetwork")
          : t("settings.backup.restoreConfirm"),
        {
          destructive: true,
          confirmLabel: t("settings.backup.restoreButton"),
        }
      ))
    ) {
      return
    }
    setError(null)
    // Same reasoning as PanelUpdateCard's handleUpdate: restorePanelBackup
    // uploads the file and swaps the live DB synchronously before
    // responding, so the dialog needs to open before that call, not after.
    setRestoring(true)
    try {
      const before = await api.getSettings()
      setBeforeBootId(before.bootId)
      await api.restorePanelBackup(file, restoreNetworkSettings)
    } catch (err) {
      setRestoring(false)
      setError(err instanceof Error ? err.message : t("settings.backup.restoreFailed"))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <CardTitle>{t("settings.backup.title")}</CardTitle>
        <CardDescription>{t("settings.backup.description")}</CardDescription>
      </div>
      <PanelRestartDialog
        open={restoring}
        beforeBootId={beforeBootId}
        title={t("settings.backup.restoreDialogTitle")}
        message={t("settings.backup.restoreDialogMessage")}
      />
      {error && <p className="text-sm text-error">{error}</p>}
      <SectionGroup className="max-w-lg">
        <SectionItem
          position="single"
          onClick={() => setRestoreNetworkSettings(!restoreNetworkSettings)}
        >
          <SwitchRow
            label={t("settings.backup.restoreNetworkSettingsLabel")}
            checked={restoreNetworkSettings}
            onCheckedChange={setRestoreNetworkSettings}
            supportingText={
              restoreNetworkSettings
                ? t("settings.backup.restoreNetworkSettingsOnHint")
                : t("settings.backup.restoreNetworkSettingsOffHint")
            }
          />
        </SectionItem>
      </SectionGroup>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={handleDownload} disabled={downloading}>
          {downloading ? t("common.downloading") : t("settings.backup.downloadButton")}
        </Button>
        <Button type="button" variant="destructive" onClick={handlePickFile}>
          {t("settings.backup.restoreButton")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".db"
          className="hidden"
          onChange={handleFileChosen}
        />
      </div>
    </div>
  )
}

function ConfigCard() {
  const t = useT()
  const [settings, setSettings] = React.useState<Record<string, string> | null>(null)

  React.useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
  }, [])

  const entries = settings
    ? Object.entries(settings).filter(([key]) => key !== "version" && key !== "bootId")
    : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <CardTitle>{t("settings.config.title")}</CardTitle>
        <CardDescription>{t("settings.config.description")}</CardDescription>
      </div>
      {settings === null ? (
        <p className="text-sm text-on-surface-variant">{t("common.loading")}</p>
      ) : (
        <SectionGroup>
          {entries.map(([key, value], index) => (
            <SectionItem
              key={key}
              position={
                entries.length === 1
                  ? "single"
                  : index === 0
                    ? "top"
                    : index === entries.length - 1
                      ? "bottom"
                      : "middle"
              }
              className="justify-between gap-4"
            >
              <span className="text-body-medium text-on-surface-variant">
                {SETTINGS_LABEL_KEYS[key] ? t(SETTINGS_LABEL_KEYS[key]) : key}
              </span>
              <span className="truncate font-mono text-body-small">{value || "—"}</span>
            </SectionItem>
          ))}
        </SectionGroup>
      )}
    </div>
  )
}

export function SettingsPage() {
  const t = useT()
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-xl font-semibold">{t("settings.pageTitle")}</h1>
      <Tabs defaultValue="account">
        <TabsList className="mb-2">
          <TabsTrigger value="account">{t("settings.account.title")}</TabsTrigger>
          <TabsTrigger value="network">{t("settings.network.title")}</TabsTrigger>
          <TabsTrigger value="update">{t("settings.update.title")}</TabsTrigger>
          <TabsTrigger value="backup">{t("settings.backup.title")}</TabsTrigger>
          <TabsTrigger value="config">{t("settings.config.title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <AccountCard />
        </TabsContent>
        <TabsContent value="network">
          <PanelNetworkCard />
        </TabsContent>
        <TabsContent value="update">
          <PanelUpdateCard />
        </TabsContent>
        <TabsContent value="backup">
          <PanelBackupCard />
        </TabsContent>
        <TabsContent value="config">
          <ConfigCard />
        </TabsContent>
      </Tabs>
    </div>
  )
}
