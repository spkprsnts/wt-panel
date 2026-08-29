import * as React from "react"
import { Link } from "react-router-dom"

import { useT } from "@/lib/i18n"
import { api, type Client, type CoreType, type KernelStatus, type SystemStats } from "@/lib/api"
import { formatBytes } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const CORE_LABELS: Record<CoreType | "xray", string> = {
  turnable: "Turnable",
  olcrtc: "olcRTC",
  webdav: "WebDAV",
  freeturn: "FreeTurn",
  xray: "Xray-core",
}

// Xray-core isn't a per-profile kernel (models.CoreXray) — it shows up in
// CORE_LABELS/kernels but Profile.CoreType is never "xray", so the
// "profiles per kernel" breakdown below iterates this list, not CORE_LABELS.
const PROFILE_CORE_TYPES: CoreType[] = ["turnable", "olcrtc", "webdav", "freeturn"]

function UsageStatCard({
  label,
  hint,
  percent,
}: {
  label: string
  hint: string | null
  percent: number | null
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">
          {percent === null ? "—" : `${percent.toFixed(0)}%`}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-surface-variant">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
          />
        </div>
        <p className="text-xs text-on-surface-variant">{hint ?? "—"}</p>
      </CardContent>
    </Card>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="pt-0 text-xs text-on-surface-variant">{hint}</CardContent>
      )}
    </Card>
  )
}

export function DashboardPage() {
  const t = useT()
  const byteUnits = React.useMemo(
    () => [
      t("clientsPage.unitByte"),
      t("clientsPage.unitKb"),
      t("clientsPage.unitMb"),
      t("clientsPage.unitGb"),
      t("clientsPage.unitTb"),
    ],
    [t]
  )
  const [clients, setClients] = React.useState<Client[] | null>(null)
  const [kernels, setKernels] = React.useState<KernelStatus[] | null>(null)
  const [stats, setStats] = React.useState<SystemStats | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    Promise.all([api.listClients(), api.listKernels()])
      .then(([c, k]) => {
        setClients(c)
        setKernels(k)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  React.useEffect(() => {
    const load = () => api.getSystemStats().then(setStats).catch(() => setStats(null))
    load()
    const id = window.setInterval(load, 5000)
    return () => window.clearInterval(id)
  }, [])

  const allProfiles = React.useMemo(
    () => (clients ?? []).flatMap((c) => c.Profiles ?? []),
    [clients]
  )
  const runningCount = allProfiles.filter((p) => p.Running).length
  const activeClients = (clients ?? []).filter((c) => c.Enabled).length
  const byCoreType = React.useMemo(() => {
    const counts = new Map<CoreType, number>()
    for (const p of allProfiles) counts.set(p.CoreType, (counts.get(p.CoreType) ?? 0) + 1)
    return counts
  }, [allProfiles])

  const memPercent = stats && stats.memTotalBytes > 0 ? (stats.memUsedBytes / stats.memTotalBytes) * 100 : null
  const diskPercent = stats && stats.diskTotalBytes > 0 ? (stats.diskUsedBytes / stats.diskTotalBytes) * 100 : null

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-xl font-semibold">{t("dashboard.title")}</h1>

      {error && <p className="mb-4 text-sm text-error">{error}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard
          label={t("sidebar.nav.clients")}
          value={clients ? clients.length : "—"}
          hint={clients ? `${activeClients} ${t("dashboard.activeCount")}` : undefined}
        />
        <StatCard label={t("clientsPage.colProfiles")} value={clients ? allProfiles.length : "—"} />
        <StatCard
          label={t("dashboard.running")}
          value={clients ? runningCount : "—"}
          hint={clients ? `${t("dashboard.ofTotal")} ${allProfiles.length}` : undefined}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <UsageStatCard
          label={t("dashboard.cpu")}
          percent={stats ? stats.cpuPercent : null}
          hint={stats ? `${stats.cpuCores} ${t("dashboard.cores")}` : null}
        />
        <UsageStatCard
          label={t("dashboard.memory")}
          percent={memPercent}
          hint={stats ? `${formatBytes(stats.memUsedBytes, byteUnits)} ${t("dashboard.ofSize")} ${formatBytes(stats.memTotalBytes, byteUnits)}` : null}
        />
        <UsageStatCard
          label={t("dashboard.storage")}
          percent={diskPercent}
          hint={stats ? `${formatBytes(stats.diskUsedBytes, byteUnits)} ${t("dashboard.ofSize")} ${formatBytes(stats.diskTotalBytes, byteUnits)}` : null}
        />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.profilesByCore")}</CardTitle>
            <CardDescription>{t("dashboard.profilesByCoreDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            {allProfiles.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{t("clientsPage.noProfiles")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {PROFILE_CORE_TYPES.map((ct) => {
                  const count = byCoreType.get(ct) ?? 0
                  const pct = allProfiles.length > 0 ? (count / allProfiles.length) * 100 : 0
                  return (
                    <div key={ct} className="flex items-center gap-3 text-sm">
                      <span className="w-20 shrink-0 text-on-surface-variant">
                        {CORE_LABELS[ct]}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-variant">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-right tabular-nums">{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sidebar.nav.kernels")}</CardTitle>
            <CardDescription>
              {t("dashboard.installedVersions")}{" "}
              <Link to="/kernels" className="underline">
                «{t("sidebar.nav.kernels")}»
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {kernels === null ? (
              <p className="text-sm text-on-surface-variant">{t("common.loading")}</p>
            ) : (
              kernels.map((k) => (
                <div key={k.coreType} className="flex items-center justify-between text-sm">
                  <span>{CORE_LABELS[k.coreType]}</span>
                  {k.installed ? (
                    <Badge>{k.version}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("kernels.notInstalled")}</Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
