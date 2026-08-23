import * as React from "react"
import { Link } from "react-router-dom"

import { api, type Client, type CoreType, type KernelStatus, type SystemStats } from "@/lib/api"
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

// Xray-core isn't a per-profile kernel (see models.CoreXray's doc comment)
// — it shows up in CORE_LABELS/kernels (install/version tracking) but a
// Profile.CoreType is never "xray", so the "profiles per kernel" breakdown
// below iterates this list, not every CORE_LABELS key.
const PROFILE_CORE_TYPES: CoreType[] = ["turnable", "olcrtc", "webdav", "freeturn"]

function formatBytes(bytes: number): string {
  if (!bytes) return "0 Б"
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

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
        <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{hint ?? "—"}</p>
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
        <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>
      )}
    </Card>
  )
}

export function DashboardPage() {
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
      <h1 className="mb-6 text-xl font-semibold">Дэшборд</h1>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard
          label="Клиенты"
          value={clients ? clients.length : "—"}
          hint={clients ? `${activeClients} активных` : undefined}
        />
        <StatCard label="Профили" value={clients ? allProfiles.length : "—"} />
        <StatCard
          label="Работают"
          value={clients ? runningCount : "—"}
          hint={clients ? `из ${allProfiles.length}` : undefined}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <UsageStatCard
          label="Процессор"
          percent={stats ? stats.cpuPercent : null}
          hint={stats ? `${stats.cpuCores} ядер` : null}
        />
        <UsageStatCard
          label="Память"
          percent={memPercent}
          hint={stats ? `${formatBytes(stats.memUsedBytes)} из ${formatBytes(stats.memTotalBytes)}` : null}
        />
        <UsageStatCard
          label="Хранилище"
          percent={diskPercent}
          hint={stats ? `${formatBytes(stats.diskUsedBytes)} из ${formatBytes(stats.diskTotalBytes)}` : null}
        />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Профили по ядрам</CardTitle>
            <CardDescription>Сколько профилей приходится на каждое ядро</CardDescription>
          </CardHeader>
          <CardContent>
            {allProfiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Профилей пока нет</p>
            ) : (
              <div className="flex flex-col gap-2">
                {PROFILE_CORE_TYPES.map((ct) => {
                  const count = byCoreType.get(ct) ?? 0
                  const pct = allProfiles.length > 0 ? (count / allProfiles.length) * 100 : 0
                  return (
                    <div key={ct} className="flex items-center gap-3 text-sm">
                      <span className="w-20 shrink-0 text-muted-foreground">
                        {CORE_LABELS[ct]}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
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
            <CardTitle>Ядра</CardTitle>
            <CardDescription>
              Установленные версии — подробнее на странице{" "}
              <Link to="/kernels" className="underline">
                «Ядра»
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {kernels === null ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : (
              kernels.map((k) => (
                <div key={k.coreType} className="flex items-center justify-between text-sm">
                  <span>{CORE_LABELS[k.coreType]}</span>
                  {k.installed ? (
                    <Badge>{k.version}</Badge>
                  ) : (
                    <Badge variant="secondary">не установлено</Badge>
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
