import * as React from "react"

import { useT } from "@/lib/i18n"
import { api, type Client, type Profile } from "@/lib/api"
import { formatBytes } from "@/lib/utils"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CreateClientDialog } from "@/components/create-client-dialog"
import { EditClientDialog } from "@/components/edit-client-dialog"
import { AddProfileDialog } from "@/components/add-profile-dialog"
import { EditProfileDialog } from "@/components/edit-profile-dialog"
import { ProfileLogsDialog } from "@/components/profile-logs-dialog"
import { QrDialog } from "@/components/qr-dialog"
import { Icon } from "@/components/icon"
import { SectionGroup, SectionItem, sectionPosition } from "@/components/ui/section"

// Best-effort JSON.parse shared by profileSummaryBadges/profilePort — a missing field or parse failure just means fewer badges/no port, never an error.
function parseCoreConfigJSON(profile: Profile): Record<string, unknown> {
  try {
    return profile.CoreConfig ? JSON.parse(profile.CoreConfig) : {}
  } catch {
    return {}
  }
}

// Pulls the most distinguishing fields out of a profile's CoreConfig JSON, since the CoreType badge alone doesn't tell two profiles of the same core apart. Port is excluded (see profilePort) so it can render in its own fixed-width slot. Values are raw technical strings, not translated.
function profileSummaryBadges(profile: Profile): string[] {
  const cfg = parseCoreConfigJSON(profile)
  const str = (v: unknown) => (typeof v === "string" && v ? v : null)
  const socks5 = typeof cfg.proxy_upstream === "string" && cfg.proxy_upstream ? "SOCKS5" : null

  let fields: (string | null)[]
  switch (profile.CoreType) {
    case "turnable":
      fields = [str(cfg.connection_type), str(cfg.proto), str(cfg.route_socket)]
      break
    case "olcrtc":
      fields = [str(cfg.provider), str(cfg.transport), socks5]
      break
    case "freeturn":
      fields = []
      break
    case "webdav":
      fields = [str(cfg.conn_mode), socks5]
      break
    default:
      fields = []
  }
  return fields.filter((v): v is string => v !== null)
}

// The port, rendered in its own fixed-width column. null for olcRTC (no local listener) and WebDAV "server" mode (relays to external backends); otherwise reflects the real running port.
function profilePort(profile: Profile): number | null {
  if (profile.CoreType === "olcrtc") return null
  const cfg = parseCoreConfigJSON(profile)
  if (profile.CoreType === "webdav" && cfg.conn_mode === "server") return null
  return typeof cfg.port === "number" && cfg.port > 0 ? cfg.port : null
}

// What the Xray overlay badge shows: the picked inbound's protocol, else the protocol sniffed from the manual fallback (URI scheme, or "wireguard").
function xraySummaryLabel(profile: Profile): string {
  if (profile.XrayInbound) return profile.XrayInbound.Protocol
  if (profile.XrayManualWireGuard) return "wireguard (WG)"
  const scheme = profile.XrayManualURI.split("://", 1)[0]?.toLowerCase()
  return scheme ? `${scheme} (URI)` : "xray (URI)"
}

// Mirrors the backend's recommendedProfileID: a Recommended pin only counts if that profile is also Enabled, else falls back to the first Enabled profile.
function effectiveRecommendedId(profiles: Profile[]): number | null {
  return (
    profiles.find((p) => p.Recommended && p.Enabled)?.ID ??
    profiles.find((p) => p.Enabled)?.ID ??
    null
  )
}

// Memoized on the two fields actually read, not on `profile` itself — the 10s poll replaces the whole `clients` array every tick even when nothing changed.
function ProfileSummaryBadges({ profile }: { profile: Profile }) {
  const badges = React.useMemo(
    () => profileSummaryBadges(profile),
    [profile.CoreConfig, profile.CoreType]
  )
  return (
    <>
      {badges.map((label, i) => (
        <Badge key={i} variant="outline">
          {label}
        </Badge>
      ))}
    </>
  )
}

// Same memoization pattern as ProfileSummaryBadges, kept separate so the fixed-width column only re-renders this, not the whole badge row.
function ProfilePortLabel({ profile }: { profile: Profile }) {
  const port = React.useMemo(
    () => profilePort(profile),
    [profile.CoreConfig, profile.CoreType]
  )
  return <>{port !== null ? `:${port}` : ""}</>
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
  const [reorderingId, setReorderingId] = React.useState<number | null>(null)
  // Which profile's Edit/Logs dialog is open. Triggered from a DropdownMenuItem, not the dialog's own DialogTrigger: nesting a Dialog inside a DropdownMenuItem is a Base UI footgun — the dropdown's close-on-select can race with the dialog opening. Lifting state here, with the dialogs unconditionally mounted per row (open just toggles), sidesteps it.
  const [editingProfileId, setEditingProfileId] = React.useState<number | null>(null)
  const [logsProfileId, setLogsProfileId] = React.useState<number | null>(null)

  const load = React.useCallback(() => {
    api
      .listClients()
      .then(setClients)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  React.useEffect(() => {
    load()
    // Profile status (Running/PID) is a live snapshot, not pushed — poll so the expanded list doesn't go stale.
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

  // Swaps `profile` with its neighbor and sends the client's full new profile order.
  async function handleMoveProfile(client: Client, profile: Profile, direction: -1 | 1) {
    const profiles = client.Profiles ?? []
    const index = profiles.findIndex((p) => p.ID === profile.ID)
    const target = index + direction
    if (index < 0 || target < 0 || target >= profiles.length) return

    const ids = profiles.map((p) => p.ID)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]

    setReorderingId(profile.ID)
    try {
      await api.reorderProfiles(client.ID, ids)
      load()
    } catch (err) {
      await alert(err instanceof Error ? err.message : t("clientsPage.reorderFailed"), { title: t("common.error") })
    } finally {
      setReorderingId(null)
    }
  }

  async function handleSetRecommended(profile: Profile, recommended: boolean) {
    try {
      await api.setProfileRecommended(profile.ID, recommended)
      load()
    } catch (err) {
      await alert(err instanceof Error ? err.message : t("clientsPage.setRecommendedFailed"), { title: t("common.error") })
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="min-w-0 text-xl font-semibold">{t("sidebar.nav.clients")}</h1>
        <div className="shrink-0">
          <CreateClientDialog onCreated={load} />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-error">{error}</p>}

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
                  className="cursor-pointer transition-colors hover:bg-surface-variant/50"
                  title={t("clientsPage.clickToExpand")}
                  onClick={() =>
                    setExpanded(expanded === client.ID ? null : client.ID)
                  }
                >
                  <TableCell>
                    <span className="flex items-center justify-center">
                      <Icon
                        name="chevron_right"
                        size={22}
                        className={`text-on-surface-variant transition-all ${
                          expanded === client.ID ? "rotate-90" : ""
                        }`}
                      />
                    </span>
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
                            <Icon name="qr_code" size={18} />
                          </Button>
                        }
                        loadVariants={() =>
                          api
                            .getSubscriptionLinks(client.ID)
                            .then(({ url, wireturnLink }) => [
                              { key: "wireturn", label: "WireTurn", content: wireturnLink },
                              { key: "text", label: t("clientsPage.textVariant"), content: `${url}?format=text` },
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
                        <Icon name="delete" size={18} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expanded === client.ID && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-surface-variant/30">
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
                          <p className="text-sm text-on-surface-variant">
                            {t("clientsPage.noProfiles")}
                          </p>
                        )}
                        <SectionGroup>
                        {(() => {
                          const recommendedId = effectiveRecommendedId(client.Profiles ?? [])
                          return (client.Profiles ?? []).map((profile, index, profiles) => (
                          <SectionItem
                            key={profile.ID}
                            position={sectionPosition(index, profiles.length)}
                            className="flex-wrap gap-3 text-sm"
                          >
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                              <span
                                className={`inline-block size-2 rounded-full ${
                                  profile.Running ? "bg-green-500" : "bg-on-surface-variant/40"
                                }`}
                                title={profile.Running ? t("profileLogs.running") : t("profileLogs.notRunning")}
                              />
                              <div className="min-w-16">
                                <Badge variant="outline">{profile.CoreType}</Badge>
                              </div>
                              {/* Pin and effective pick are separate badges: a pin on a disabled profile still shows, dimmed. */}
                              {profile.Recommended && (
                                <Icon
                                  name="star"
                                  filled
                                  size={16}
                                  className={profile.Enabled ? "text-amber-500" : "text-amber-500/40"}
                                  title={profile.Enabled ? t("clientsPage.recommendedTitle") : t("clientsPage.recommendedPinnedInactiveTitle")}
                                />
                              )}
                              {!profile.Recommended && profile.ID === recommendedId && (
                                <Icon
                                  name="star"
                                  size={16}
                                  className="text-on-surface-variant/50"
                                  title={t("clientsPage.recommendedDefaultTitle")}
                                />
                              )}
                              <span>{profile.Name}</span>
                              {!profile.Enabled && (
                                <Badge variant="secondary">{t("clientsPage.profileDisabled")}</Badge>
                              )}
                              <ProfileSummaryBadges profile={profile} />
                              {profile.XrayEnabled && (
                                <Badge variant="secondary">{xraySummaryLabel(profile)}</Badge>
                              )}
                            </div>
                            {/* Fixed width so ports line up instead of landing wherever they fall among the summary badges above. */}
                            <span className="w-12 shrink-0 text-right font-mono text-xs text-on-surface-variant">
                              <ProfilePortLabel profile={profile} />
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                title={t("clientsPage.moveProfileUp")}
                                disabled={index === 0 || reorderingId !== null}
                                onClick={() => handleMoveProfile(client, profile, -1)}
                              >
                                <Icon name="arrow_upward" size={18} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title={t("clientsPage.moveProfileDown")}
                                disabled={index === profiles.length - 1 || reorderingId !== null}
                                onClick={() => handleMoveProfile(client, profile, 1)}
                              >
                                <Icon name="arrow_downward" size={18} />
                              </Button>
                              <QrDialog
                                title={`${t("clientsPage.profileTitle")} — ${profile.Name}`}
                                trigger={
                                  <Button size="sm" variant="ghost" title={t("clientsPage.profileQrTitle")}>
                                    <Icon name="qr_code" size={18} />
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
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button size="sm" variant="ghost" title={t("common.moreActions")}>
                                      <Icon name="more_vert" size={18} />
                                    </Button>
                                  }
                                />
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setEditingProfileId(profile.ID)}>
                                    <Icon name="edit" size={18} /> {t("profileDialogs.editTooltip")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setLogsProfileId(profile.ID)}>
                                    <Icon name="history" size={18} /> {t("profileLogs.trigger")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleSetRecommended(profile, !profile.Recommended)}
                                  >
                                    <Icon name="star" filled={profile.Recommended} size={18} />
                                    {profile.Recommended ? t("clientsPage.unmarkRecommended") : t("clientsPage.markRecommended")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={restartingId === profile.ID || !profile.Enabled}
                                    onClick={() => handleRestartProfile(profile.ID)}
                                  >
                                    {restartingId === profile.ID ? (
                                      <Icon name="progress_activity" size={18} className="animate-spin" />
                                    ) : (
                                      <Icon name="restart_alt" size={18} />
                                    )}
                                    {profile.Enabled
                                      ? t("clientsPage.restartProfileTitle")
                                      : t("clientsPage.profileDisabled")}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => handleDeleteProfile(profile.ID)}
                                  >
                                    <Icon name="delete" size={18} /> {t("common.delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            {/* Unconditionally mounted so toggling open never unmounts/remounts these — see editingProfileId's comment above. */}
                            <EditProfileDialog
                              profile={profile}
                              open={editingProfileId === profile.ID}
                              onOpenChange={(o) => setEditingProfileId(o ? profile.ID : null)}
                              onUpdated={load}
                            />
                            <ProfileLogsDialog
                              profileId={profile.ID}
                              profileName={profile.Name}
                              open={logsProfileId === profile.ID}
                              onOpenChange={(o) => setLogsProfileId(o ? profile.ID : null)}
                            />
                          </SectionItem>
                          ))
                        })()}
                        </SectionGroup>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-on-surface-variant">
                  {t("clientsPage.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
    </div>
  )
}
