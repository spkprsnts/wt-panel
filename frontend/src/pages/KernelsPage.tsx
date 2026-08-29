import * as React from "react"

import { useT } from "@/lib/i18n"
import { api, type BuildJob, type Commit, type KernelStatus, type Release } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Icon } from "@/components/icon"

// kernelJobPollTimeoutMs bounds each individual status poll request so a
// single hung request can't stall the recursive poll() chain forever — see
// SettingsPage's restartPollTimeoutMs for the same fix applied there first.
const kernelJobPollTimeoutMs = 10000

function formatDate(iso?: string) {
  if (!iso) return null
  return new Date(iso).toLocaleString("ru-RU")
}

function StatusLine({ status }: { status?: KernelStatus }) {
  const t = useT()
  if (!status) return <p className="text-sm text-on-surface-variant">{t("common.loading")}</p>
  if (!status.installed) {
    return <Badge variant="secondary">{t("kernels.notInstalled")}</Badge>
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge>{status.version}</Badge>
      <span className="text-on-surface-variant">
        {status.source === "build" ? t("kernels.sourceBuild") : t("kernels.sourceRelease")} · {formatDate(status.installedAt)}
      </span>
    </div>
  )
}

// useKernelJob centralizes job tracking for every kernel (Turnable/
// FreeTurn/Xray-core's simple release installs, and olcRTC's build) so all
// four behave identically: on mount it asks the backend "what's the latest
// job for this kernel" (see api.getKernelJob) instead of starting from a
// blank slate, which is what lets an in-progress install/build keep
// showing "running" — and keep polling — across a full page reload,
// rather than the button just silently going back to "Install" while
// the download/build actually continues server-side regardless.
function useKernelJob(kernelName: string, onInstalled: () => void) {
  const t = useT()
  const [job, setJob] = React.useState<BuildJob | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const pollRef = React.useRef<number | null>(null)
  // Set once start() kicks off a fresh job — guards the mount-time "what's
  // already running" fetch below from overwriting it with a stale snapshot
  // if that fetch resolves late, after the operator already clicked
  // Install/Build.
  const startedRef = React.useRef(false)

  const poll = React.useCallback(
    (jobId: string) => {
      pollRef.current = window.setTimeout(async () => {
        try {
          const updated = await api.getKernelJob(kernelName, kernelJobPollTimeoutMs)
          setError(null)
          if (!updated) return
          setJob(updated)
          if (updated.status === "running") {
            poll(jobId)
          } else if (updated.status === "success") {
            onInstalled()
          }
        } catch (err) {
          // A transient error (timeout, dropped connection) must not kill the
          // chain — the build keeps running server-side regardless, so keep
          // polling rather than stranding the UI on a stale "running" state.
          setError(err instanceof Error ? err.message : String(err))
          poll(jobId)
        }
      }, 2000)
    },
    [kernelName, onInstalled]
  )

  React.useEffect(() => {
    startedRef.current = false
    api
      .getKernelJob(kernelName)
      .then((existing) => {
        if (!existing || startedRef.current) return
        setJob(existing)
        if (existing.status === "running") poll(existing.id)
      })
      .catch(() => {})
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current)
    }
  }, [kernelName, poll])

  function start(trigger: () => Promise<BuildJob>) {
    setError(null)
    startedRef.current = true
    return trigger()
      .then((started) => {
        setJob(started)
        poll(started.id)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("kernels.startFailed"))
      })
  }

  return { job, error, start, running: job?.status === "running" }
}

// RefreshButton bypasses the backend's releases/commits cache (see
// kernels.ListReleases/ListCommits — 10 min TTL) for whichever list it sits
// next to. Most requests to GitHub come from this list being re-fetched on
// every page load, not from actually installing anything, so serving that
// from cache — with this as the manual escape hatch — is what keeps the
// panel usable once GitHub's rate limit has been hit.
function RefreshButton({ refreshing, onClick }: { refreshing: boolean; onClick: () => void }) {
  const t = useT()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs text-on-surface-variant"
      onClick={onClick}
      disabled={refreshing}
    >
      <Icon name="refresh" size={14} className={refreshing ? "animate-spin" : ""} />
      {t("kernels.refreshList")}
    </Button>
  )
}

function JobLog({ job }: { job: BuildJob | null }) {
  const t = useT()
  const logRef = React.useRef<HTMLPreElement | null>(null)

  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.log])

  if (!job || job.status === "success") return null
  return (
    <div className="flex flex-col gap-2">
      <Badge variant={job.status === "failed" ? "destructive" : "secondary"} className="w-fit gap-1">
        {job.status === "running" && <Icon name="progress_activity" size={12} className="animate-spin" />}
        {job.status === "running" ? t("kernels.jobRunning") : t("kernels.jobFailed")}
      </Badge>
      <pre
        ref={logRef}
        className="max-h-64 overflow-auto rounded-md border bg-surface-variant/30 p-3 text-xs whitespace-pre-wrap"
      >
        {job.log || "..."}
      </pre>
    </div>
  )
}

function ReleaseKernelCard({
  title,
  description,
  status,
  kernelName,
  listReleases,
  install,
  onInstalled,
}: {
  title: string
  description: string
  status?: KernelStatus
  kernelName: string
  listReleases: (refresh?: boolean) => Promise<Release[]>
  install: (version?: string) => Promise<BuildJob>
  onInstalled: () => void
}) {
  const t = useT()
  const [releases, setReleases] = React.useState<Release[] | null>(null)
  const [selected, setSelected] = React.useState<string>("")
  const [refreshing, setRefreshing] = React.useState(false)
  const { job, error, start, running } = useKernelJob(kernelName, onInstalled)

  const load = React.useCallback(
    (refresh: boolean) => {
      const wasSelected = selected
      return listReleases(refresh).then((rs) => {
        setReleases(rs)
        if (!rs.some((r) => r.tag_name === wasSelected)) {
          setSelected(rs.length > 0 ? rs[0].tag_name : "")
        }
      })
    },
    [listReleases, selected]
  )

  React.useEffect(() => {
    load(false).catch(() => {})
    // only on mount for this kernel — handleRefresh below covers re-fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernelName])

  function handleInstall() {
    start(() => install(selected))
  }

  function handleRefresh() {
    setRefreshing(true)
    load(true).finally(() => setRefreshing(false))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StatusLine status={status} />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>{t("kernels.releaseVersionLabel")}</Label>
            <RefreshButton refreshing={refreshing} onClick={handleRefresh} />
          </div>
          {releases === null ? (
            <p className="text-sm text-on-surface-variant">{t("kernels.loadingReleases")}</p>
          ) : releases.length === 0 ? (
            <p className="text-sm text-on-surface-variant">{t("kernels.noReleases")}</p>
          ) : (
            <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => {
                    const r = releases.find((r) => r.tag_name === v)
                    return r ? `${r.name || r.tag_name}${r.prerelease ? " (pre-release)" : ""}` : v
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {releases.map((r) => (
                  <SelectItem key={r.tag_name} value={r.tag_name}>
                    {r.name || r.tag_name}
                    {r.prerelease ? " (pre-release)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <Button onClick={handleInstall} disabled={running || !selected}>
          {running && <Icon name="progress_activity" size={16} className="animate-spin" />}
          {running ? t("kernels.installing") : t("kernels.install")}
        </Button>

        <JobLog job={job} />
      </CardContent>
    </Card>
  )
}

function OlcrtcKernelCard({ status, onInstalled }: { status?: KernelStatus; onInstalled: () => void }) {
  const t = useT()
  const [commits, setCommits] = React.useState<Commit[] | null>(null)
  const [selected, setSelected] = React.useState<string>("")
  const [customRef, setCustomRef] = React.useState("")
  const [refreshing, setRefreshing] = React.useState(false)
  const { job, error, start, running: building } = useKernelJob("olcrtc", onInstalled)

  const load = React.useCallback(
    (refresh: boolean) => {
      const wasSelected = selected
      return api.listOlcrtcCommits(refresh).then((cs) => {
        setCommits(cs)
        if (!cs.some((c) => c.sha === wasSelected)) {
          setSelected(cs.length > 0 ? cs[0].sha : "")
        }
      })
    },
    [selected]
  )

  React.useEffect(() => {
    load(false).catch(() => {})
    // only on mount — handleRefresh below covers re-fetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleBuild() {
    const ref = (customRef.trim() || selected).trim()
    if (!ref) return
    start(() => api.buildOlcrtc(ref))
  }

  function handleRefresh() {
    setRefreshing(true)
    load(true).finally(() => setRefreshing(false))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>olcRTC</CardTitle>
        <CardDescription>
          {t("kernels.olcrtc.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StatusLine status={status} />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>{t("kernels.olcrtc.commitLabel")}</Label>
            <RefreshButton refreshing={refreshing} onClick={handleRefresh} />
          </div>
          {commits === null ? (
            <p className="text-sm text-on-surface-variant">{t("kernels.olcrtc.loadingCommits")}</p>
          ) : (
            <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => {
                    const c = commits.find((c) => c.sha === v)
                    return c ? `${c.sha.slice(0, 7)} — ${c.commit.message.split("\n")[0].slice(0, 60)}` : v
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {commits.map((c) => (
                  <SelectItem key={c.sha} value={c.sha}>
                    {c.sha.slice(0, 7)} — {c.commit.message.split("\n")[0].slice(0, 60)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="custom-ref">{t("kernels.olcrtc.customRefLabel")}</Label>
          <Input
            id="custom-ref"
            value={customRef}
            onChange={(e) => setCustomRef(e.target.value)}
            placeholder={t("kernels.olcrtc.customRefPlaceholder")}
          />
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <Button onClick={handleBuild} disabled={building}>
          {building && <Icon name="progress_activity" size={16} className="animate-spin" />}
          {building ? t("kernels.olcrtc.building") : t("kernels.olcrtc.build")}
        </Button>

        <JobLog job={job} />
      </CardContent>
    </Card>
  )
}

export function KernelsPage() {
  const t = useT()
  const [kernels, setKernels] = React.useState<KernelStatus[]>([])

  const load = React.useCallback(() => {
    api.listKernels().then(setKernels).catch(() => {})
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const byType = React.useMemo(() => {
    const m = new Map<string, KernelStatus>()
    kernels.forEach((k) => m.set(k.coreType, k))
    return m
  }, [kernels])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("sidebar.nav.kernels")}</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ReleaseKernelCard
          title="Turnable"
          description={t("kernels.turnable.description")}
          status={byType.get("turnable")}
          kernelName="turnable"
          listReleases={api.listTurnableReleases}
          install={api.installTurnable}
          onInstalled={load}
        />
        <ReleaseKernelCard
          title="FreeTurn"
          description={t("kernels.freeturn.description")}
          status={byType.get("freeturn")}
          kernelName="freeturn"
          listReleases={api.listFreeTurnReleases}
          install={api.installFreeTurn}
          onInstalled={load}
        />
        <ReleaseKernelCard
          title="Xray-core"
          description={t("kernels.xray.description")}
          status={byType.get("xray")}
          kernelName="xray"
          listReleases={api.listXrayReleases}
          install={api.installXray}
          onInstalled={load}
        />
        <ReleaseKernelCard
          title="WebDAV-tunnel"
          description={t("kernels.webdav.description")}
          status={byType.get("webdav")}
          kernelName="webdav"
          listReleases={api.listWebdavReleases}
          install={api.installWebdav}
          onInstalled={load}
        />
        <div className="md:col-span-2">
          <OlcrtcKernelCard status={byType.get("olcrtc")} onInstalled={load} />
        </div>
      </div>
    </div>
  )
}
