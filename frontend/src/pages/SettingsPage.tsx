import * as React from "react"

import { api } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
import { useT } from "@/lib/i18n"
import type { TranslationKey } from "@/i18n"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { OtpInput } from "@/components/ui/otp-input"
import { CardDescription, CardTitle } from "@/components/ui/card"
import {
  SectionGroup,
  SectionItem,
  LabelGroup,
  SwitchRow,
  TextFieldRow,
  sectionPosition,
} from "@/components/ui/section"
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

// Walks the operator through 2FA setup: scan a QR (or type the secret), then prove the authenticator app works before the secret is persisted.
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
    // `t` is intentionally excluded: switching language while open must not re-run setup and mint a new secret/QR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleConfirm(e?: React.FormEvent, codeOverride?: string) {
    e?.preventDefault()
    if (loading) return
    setConfirmError(null)
    setLoading(true)
    try {
      await api.confirmTotpSetup(secret, codeOverride ?? code)
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
              <Label id="totp-confirm-code-label">{t("settings.account.totp.codeLabel")}</Label>
              <OtpInput
                id="totp-confirm-code"
                aria-labelledby="totp-confirm-code-label"
                value={code}
                onChange={setCode}
                onComplete={(v) => handleConfirm(undefined, v)}
                autoFocus
              />
            </div>
            {confirmError && <p className="text-sm text-error">{confirmError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={loading || code.length !== 6}>
                {loading ? t("common.saving") : t("settings.account.totp.confirmButton")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Requires one more valid code before turning 2FA off — a stolen bearer token alone isn't enough to disable it.
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

  async function handleSubmit(e?: React.FormEvent, codeOverride?: string) {
    e?.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      await api.disableTotp(codeOverride ?? code)
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
            <Label id="totp-disable-code-label">{t("settings.account.totp.codeLabel")}</Label>
            <OtpInput
              id="totp-disable-code"
              aria-labelledby="totp-disable-code-label"
              value={code}
              onChange={setCode}
              onComplete={(v) => handleSubmit(undefined, v)}
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={loading || code.length !== 6}>
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

// Guesses the address the panel will be reachable at once a network-settings restart completes, so PanelRestartDialog can navigate there directly instead of reloading the current URL (which 404s on a changed base path). Best-effort: blank fields fall back to window.location.
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

// Reads the browser's address bar, not PanelSettings.TLSCertFile, since a reverse proxy commonly terminates TLS in front of the panel and would get wrongly flagged. Loopback addresses are excluded since they aren't exposed to network interception.
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

// Governs how PanelRestartDialog waits for the panel after a restart/self-update. Compares /api/settings' bootId against beforeBootId rather than waiting for one request failure, since the backend's down-window can finish faster than the poll interval and no poll would ever land in the gap. `version` doesn't work as a signal since it's unchanged across a plain restart; bootId is a fresh random value per process either way.
const restartPollIntervalMs = 2000
// True worst case is maxAttempts * (intervalMs + timeoutMs), not just maxAttempts * intervalMs, since each attempt can take up to restartPollTimeoutMs before the next interval delay starts.
const restartPollMaxAttempts = 60
// Bounds each poll request — a self-restart (syscall.Exec swapping the process image) can leave an in-flight request never resolving, wedging the recursive poll chain forever without a timeout.
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
  // Where to send the browser once the panel is confirmed back up (PanelNetworkCard's buildTargetUrl guess); a plain update restart leaves this unset and reloads in place.
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

    // True when the operator changed the panel's domain/port: the browser is stuck polling the OLD address, which never comes back, so instead a `no-cors` fetch of the NEW address just asks "does anything answer here yet" (the response body is hidden cross-origin, but resolve/reject is all this needs); the eventual top-level navigation is never CORS-restricted.
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
    // Open the blocking dialog before the network call: updatePanel() downloads and installs synchronously before responding, so awaiting it first left a multi-second gap with no dialog.
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

// The "download/restore everything" counterpart to the per-client profile exports elsewhere. Restore replaces the entire live database (admin account included), so it goes through confirm() with destructive:true.
function PanelBackupCard() {
  const t = useT()
  const { confirm } = useDialogPrompt()
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = React.useState(false)
  const [restoring, setRestoring] = React.useState(false)
  const [beforeBootId, setBeforeBootId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // Off by default: the realistic case is restoring a backup from a DIFFERENT VPS onto one already set up with its own correct IP/domain/SSL, where applying the backup's network settings would overwrite that.
  const [restoreNetworkSettings, setRestoreNetworkSettings] = React.useState(false)
  // Aborts an in-flight download/restore on unmount — these requests have no timeout of their own (a large backup takes a while).
  const transferAbortRef = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => transferAbortRef.current?.abort(), [])

  async function handleDownload() {
    setError(null)
    setDownloading(true)
    const controller = new AbortController()
    transferAbortRef.current = controller
    try {
      await api.downloadPanelBackup(controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
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
    // Same reasoning as PanelUpdateCard.handleUpdate: restorePanelBackup swaps the live DB synchronously before responding, so open the dialog before the call.
    setRestoring(true)
    const controller = new AbortController()
    transferAbortRef.current = controller
    try {
      const before = await api.getSettings()
      setBeforeBootId(before.bootId)
      await api.restorePanelBackup(file, restoreNetworkSettings, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
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
          role="switch"
          aria-checked={restoreNetworkSettings}
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
              position={sectionPosition(index, entries.length)}
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
