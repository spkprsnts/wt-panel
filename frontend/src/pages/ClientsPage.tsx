import * as React from "react"

import { useT } from "@/lib/i18n"
import { api, type Client, type Profile } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CreateClientDialog } from "@/components/create-client-dialog"
import { EditClientDialog } from "@/components/edit-client-dialog"
import { AddProfileDialog } from "@/components/add-profile-dialog"
import { EditProfileDialog } from "@/components/edit-profile-dialog"
import { ProfileLogsDialog } from "@/components/profile-logs-dialog"
import { QrDialog } from "@/components/qr-dialog"
import { ChevronRight, Loader2, QrCode, RotateCw, Trash2 } from "lucide-react"

// profileSummaryBadges pulls a couple of the most distinguishing fields out
// of a profile's own CoreConfig JSON — the CoreType badge alone doesn't tell
// two olcRTC (or two FreeTurn, etc.) profiles apart at a glance, so this
// surfaces whichever settings actually vary in practice per core (provider/
// transport for olcRTC; connection type/proto/route socket for Turnable;
// connection mode for WebDAV — FreeTurn has nothing else worth surfacing,
// so it's just the port), plus the actual listen port for every core except
// olcRTC (which has none
// — see docs/settings.md upstream, it's a pure client library, not a local
// listener). The backend always persists `port` once a profile's been
// provisioned (Turnable/FreeTurn/WebDAV's own Go structs have no
// `omitempty` on that field — see their provisioner/config.go), whether it
// was auto-assigned or operator-specified, so this reflects the real
// running port, not just a manually-typed one. Values are the raw technical
// strings already used elsewhere on this page (CoreType itself,
// XrayInbound.Protocol) — not translated, same convention. Best-effort: a
// profile saved before a field existed, or a parse failure, just means
// fewer badges, never an error.
function profileSummaryBadges(profile: Profile): string[] {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = profile.CoreConfig ? JSON.parse(profile.CoreConfig) : {}
  } catch {
    return []
  }
  const str = (v: unknown) => (typeof v === "string" && v ? v : null)
  const port = typeof cfg.port === "number" && cfg.port > 0 ? `:${cfg.port}` : null

  let fields: (string | null)[]
  switch (profile.CoreType) {
    case "turnable":
      fields = [str(cfg.connection_type), str(cfg.proto), str(cfg.route_socket), port]
      break
    case "olcrtc":
      fields = [str(cfg.provider), str(cfg.transport)]
      break
    case "freeturn":
      fields = [port]
      break
    case "webdav":
      // "server" mode relays out to external backends — no local listener,
      // so no port to show, same reasoning as olcRTC.
      fields = [str(cfg.conn_mode), cfg.conn_mode === "server" ? null : port]
      break
    default:
      fields = []
  }
  return fields.filter((v): v is string => v !== null)
}

function formatBytes(n: number, units: string[]): string {
  if (n <= 0) return "0"
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export function ClientsPage() {
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
  const { confirm, alert } = useDialogPrompt()
  const [clients, setClients] = React.useState<Client[]>([])
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [restartingId, setRestartingId] = React.useState<number | null>(null)

  const load = React.useCallback(() => {
    api
      .listClients()
      .then(setClients)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  React.useEffect(() => {
    load()
    // Profile status (Running/PID) is a live snapshot from the server, not
    // pushed — poll so the indicators in the expanded profile list don't
    // silently go stale while the page just sits open.
    const interval = window.setInterval(load, 10000)
    return () => window.clearInterval(interval)
  }, [load])

  async function handleDeleteClient(id: number) {
    if (!(await confirm(t("clientsPage.deleteClientConfirm"), { destructive: true, confirmLabel: t("common.delete") })))
      return
    await api.deleteClient(id)
    load()
  }

  async function handleDeleteProfile(id: number) {
    if (!(await confirm(t("clientsPage.deleteProfileConfirm"), { destructive: true, confirmLabel: t("common.delete") }))) return
    await api.deleteProfile(id)
    load()
  }

  async function handleRestartProfile(id: number) {
    setRestartingId(id)
    try {
      await api.restartProfile(id)
      load()
    } catch (err) {
      await alert(err instanceof Error ? err.message : t("clientsPage.restartFailed"), { title: t("common.error") })
    } finally {
      setRestartingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("sidebar.nav.clients")}</h1>
        <CreateClientDialog onCreated={load} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{t("clientsPage.colName")}</TableHead>
              <TableHead>{t("clientsPage.colStatus")}</TableHead>
              <TableHead>{t("clientsPage.colTraffic")}</TableHead>
              <TableHead>{t("clientsPage.colProfiles")}</TableHead>
              <TableHead className="text-right">{t("clientsPage.colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <React.Fragment key={client.ID}>
                <TableRow
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  title={t("clientsPage.clickToExpand")}
                  onClick={() =>
                    setExpanded(expanded === client.ID ? null : client.ID)
                  }
                >
                  <TableCell>
                    <ChevronRight
                      className={`size-4 text-muted-foreground transition-transform ${
                        expanded === client.ID ? "rotate-90" : ""
                      }`}
                    />
                  </TableCell>
                  <TableCell>{client.Name}</TableCell>
                  <TableCell>
                    <Badge variant={client.Enabled ? "default" : "secondary"}>
                      {client.Enabled ? t("clientsPage.active") : t("clientsPage.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatBytes(client.TrafficUsedByte, byteUnits)}
                    {client.TrafficLimitByte > 0 &&
                      ` / ${formatBytes(client.TrafficLimitByte, byteUnits)}`}
                  </TableCell>
                  <TableCell>{client.Profiles?.length ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <div
                      className="inline-flex gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <QrDialog
                        title={`${t("clientsPage.subscriptionTitle")} — ${client.Name}`}
                        trigger={
                          <Button size="sm" variant="outline" title={t("clientsPage.subscriptionQrTitle")}>
                            <QrCode className="size-4" />
                          </Button>
                        }
                        loadVariants={() =>
                          api
                            .getSubscriptionLinks(client.ID)
                            .then(({ url, wireturnLink, domainUrl, domainWireturnLink }) => [
                              {
                                key: "wireturn",
                                label: "WireTurn",
                                content: domainWireturnLink
                                  ? { ip: wireturnLink, domain: domainWireturnLink }
                                  : wireturnLink,
                              },
                              {
                                key: "text",
                                label: t("clientsPage.textVariant"),
                                content: domainUrl
                                  ? { ip: `${url}?format=text`, domain: `${domainUrl}?format=text` }
                                  : `${url}?format=text`,
                              },
                            ])
                        }
                        onDownload={() => api.downloadClientExport(client.ID)}
                        downloadLabel={t("clientsPage.downloadAllProfiles")}
                      />
                      <EditClientDialog client={client} onUpdated={load} />
                      <Button
                        size="sm"
                        variant="destructive"
                        title={t("common.delete")}
                        onClick={() => handleDeleteClient(client.ID)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expanded === client.ID && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30">
                      <div className="flex flex-col gap-3 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{t("clientsPage.colProfiles")}</span>
                          <AddProfileDialog
                            clientId={client.ID}
                            existingProfileCount={(client.Profiles ?? []).length}
                            onCreated={load}
                          />
                        </div>
                        {(client.Profiles ?? []).length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            {t("clientsPage.noProfiles")}
                          </p>
                        )}
                        {(client.Profiles ?? []).map((profile) => (
                          <div
                            key={profile.ID}
                            className="flex items-center justify-between rounded-md border bg-background p-2 text-sm"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-block size-2 rounded-full ${
                                  profile.Running ? "bg-green-500" : "bg-muted-foreground/40"
                                }`}
                                title={profile.Running ? t("profileLogs.running") : t("profileLogs.notRunning")}
                              />
                              <Badge variant="outline">{profile.CoreType}</Badge>
                              <span>{profile.Name}</span>
                              {profileSummaryBadges(profile).map((label, i) => (
                                <Badge key={i} variant="outline">
                                  {label}
                                </Badge>
                              ))}
                              {profile.XrayEnabled && (
                                <Badge variant="secondary">
                                  {profile.XrayInbound?.Protocol ?? "xray (URI)"}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <QrDialog
                                title={`${t("clientsPage.profileTitle")} — ${profile.Name}`}
                                trigger={
                                  <Button size="sm" variant="ghost" title={t("clientsPage.profileQrTitle")}>
                                    <QrCode className="size-4" />
                                  </Button>
                                }
                                loadVariants={() =>
                                  api.getProfileLinks(profile.ID).then(({ kernelUri, wireturnLink }) => [
                                    { key: "wireturn", label: "WireTurn", content: wireturnLink },
                                    { key: "kernel", label: t("clientsPage.kernelUri"), content: kernelUri },
                                  ])
                                }
                                onDownload={() => api.downloadProfileExport(profile.ID)}
                                downloadLabel={t("clientsPage.downloadProfile")}
                              />
                              <EditProfileDialog profile={profile} onUpdated={load} />
                              <ProfileLogsDialog profileId={profile.ID} profileName={profile.Name} />
                              <Button
                                size="sm"
                                variant="ghost"
                                title={t("clientsPage.restartProfileTitle")}
                                disabled={restartingId === profile.ID}
                                onClick={() => handleRestartProfile(profile.ID)}
                              >
                                {restartingId === profile.ID ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <RotateCw className="size-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                title={t("common.delete")}
                                onClick={() => handleDeleteProfile(profile.ID)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t("clientsPage.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
