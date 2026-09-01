import * as React from "react"

import { useT, useLanguage } from "@/lib/i18n"
import { api, type BuildJob, type Commit, type KernelStatus, type Release } from "@/lib/api"
import { formatDateTime } from "@/lib/utils"
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

// Bounds each status poll request so a single hung request can't stall the recursive poll() chain forever (same fix as SettingsPage's restartPollTimeoutMs).
const kernelJobPollTimeoutMs = 10000

function StatusLine({ status }: { status?: KernelStatus }) {
  const t = useT()
  const [language] = useLanguage()
  if (!status) return <p className="text-sm text-on-surface-variant">{t("common.loading")}</p>
  if (!status.installed) {
    return <Badge variant="secondary">{t("kernels.notInstalled")}</Badge>
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge>{status.version}</Badge>
      <span className="text-on-surface-variant">
        {status.source === "build" ? t("kernels.sourceBuild") : t("kernels.sourceRelease")}
        {status.installedAt && ` · ${formatDateTime(status.installedAt, language)}`}
      </span>
    </div>
  )
}

// Centralizes job tracking for every kernel: on mount it asks the backend for the latest job instead of starting blank, so an in-progress install/build keeps showing "running" (and polling) across a page reload.
function useKernelJob(kernelName: string, onInstalled: () => void) {
  const t = useT()
  const [job, setJob] = React.useState<BuildJob | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const pollRef = React.useRef<number | null>(null)
  // Set once start() kicks off a fresh job — guards the mount-time fetch below from overwriting it with a stale snapshot if that fetch resolves late.
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
          // A transient error must not kill the chain — the build keeps running server-side, so keep polling rather than stranding the UI.
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

// Manual escape hatch past the backend's releases/commits cache (10 min TTL); serving from cache by default is what keeps the panel usable once GitHub's rate limit is hit.
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

// "Pick one item from a refreshable list" shape shared by the release and commit pickers below; trigger label and item list derive from the same itemLabel so they can't drift apart.
function PickerSelect<T>({
  label,
  items,
  itemKey,
  itemLabel,
  value,
  onValueChange,
  refreshing,
  onRefresh,
  loadingText,
  emptyText,
}: {
  label: string
  items: T[] | null
  itemKey: (item: T) => string
  itemLabel: (item: T) => React.ReactNode
  value: string
  onValueChange: (v: string) => void
  refreshing: boolean
  onRefresh: () => void
  loadingText: string
  emptyText?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <RefreshButton refreshing={refreshing} onClick={onRefresh} />
      </div>
      {items === null ? (
        <p className="text-sm text-on-surface-variant">{loadingText}</p>
      ) : emptyText && items.length === 0 ? (
        <p className="text-sm text-on-surface-variant">{emptyText}</p>
      ) : (
        <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string | null) => {
                const item = items.find((i) => itemKey(i) === v)
                return item ? itemLabel(item) : v
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={itemKey(item)} value={itemKey(item)}>
                {itemLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
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

        <PickerSelect
          label={t("kernels.releaseVersionLabel")}
          items={releases}
          itemKey={(r) => r.tag_name}
          itemLabel={(r) => `${r.name || r.tag_name}${r.prerelease ? " (pre-release)" : ""}`}
          value={selected}
          onValueChange={setSelected}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          loadingText={t("kernels.loadingReleases")}
          emptyText={t("kernels.noReleases")}
        />

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

        <PickerSelect
          label={t("kernels.olcrtc.commitLabel")}
          items={commits}
          itemKey={(c) => c.sha}
          itemLabel={(c) => `${c.sha.slice(0, 7)} — ${c.commit.message.split("\n")[0].slice(0, 60)}`}
          value={selected}
          onValueChange={setSelected}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          loadingText={t("kernels.olcrtc.loadingCommits")}
        />

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
