import * as React from "react"

import { api, type CallRoom, type CoreType, type RoomProvider, type XrayInbound } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { MultiSelect } from "@/components/ui/multi-select"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DialogFooter } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

// WebDAV is deliberately not offered here yet — its provisioner exists but
// this form doesn't cover it, see README "Статус реализации".
const CORE_LABELS: Record<"turnable" | "olcrtc" | "freeturn", string> = {
  turnable: "Turnable (TURN/SFU)",
  olcrtc: "olcRTC (видеоконференции)",
  freeturn: "FreeTurn (WebRTC/UDP)",
}

// useCallRooms feeds the "Комнаты звонков" journal into whichever combobox
// wants it as suggestions (Turnable's single call id, FreeTurn's multiple
// links, olcRTC's room id) — one fetch per provider, shared instead of each
// field re-fetching independently the way the old per-field RoomQuickPick
// used to.
function useCallRooms(provider: RoomProvider): CallRoom[] {
  const [rooms, setRooms] = React.useState<CallRoom[]>([])
  React.useEffect(() => {
    api.listCallRooms(provider).then(setRooms).catch(() => setRooms([]))
  }, [provider])
  return rooms
}

// VkCallHint is shared by Turnable's (single) and FreeTurn's (multiple)
// call-id fields — both ultimately need the same "where do I even get one
// of these" instructions, since both take a bare VK Calls id, not a link.
function VkCallHint() {
  return (
    <p className="text-xs text-muted-foreground">
      Перейдите на vk.com/calls и создайте звонок. В адресной строке
      появится ссылка вида <code>vk.com/call/join/ABC123xyz...</code> —
      скопируйте всё после <code>/join/</code>.
      <br />
      Совет: можно поискать в Google <code>"https://vk.com/call/join/"</code>,
      чтобы найти уже существующую публичную комнату.
    </p>
  )
}

function AdvancedFields({ children }: { children: React.ReactNode }) {
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium text-muted-foreground">
        Расширенные настройки (необязательно)
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  )
}

function KeyField({
  id,
  label,
  value,
  onChange,
  onGenerate,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  onGenerate: () => Promise<unknown>
  placeholder?: string
}) {
  const [generating, setGenerating] = React.useState(false)
  const [genError, setGenError] = React.useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      await onGenerate()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Не удалось сгенерировать ключ")
    } finally {
      setGenerating(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "оставьте пустым и нажмите «Сгенерировать»"}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? "..." : "Сгенерировать"}
        </Button>
      </div>
      {genError && <p className="text-xs text-destructive">{genError}</p>}
    </div>
  )
}

interface TurnableState {
  connectionType: "relay" | "direct"
  platformId: string
  callId: string
  pubKey: string
  privKey: string
  proto: "srtp" | "dtls" | "none"
  encryption: "handshake" | "full"
  routeHost: string
  routePort: string
  routeSocket: "udp" | "tcp"
  routeTransport: "none" | "kcp"
  peers: string
}

const initialTurnable: TurnableState = {
  connectionType: "relay",
  platformId: "vk.com",
  callId: "",
  pubKey: "",
  privKey: "",
  proto: "srtp",
  encryption: "handshake",
  routeHost: "127.0.0.1",
  routePort: "",
  routeSocket: "udp",
  routeTransport: "none",
  peers: "10",
}

interface OlcrtcState {
  provider: "jitsi" | "telemost" | "wbstream"
  roomId: string
  cryptoKey: string
  dns: string
  transport: "datachannel" | "vp8channel" | "seichannel" | "videochannel"
  vp8Fps: string
  vp8Batch: string
  seiFps: string
  seiBatch: string
  seiFrag: string
  seiAck: string
  videoCodec: "qrcode" | "tile"
  videoWidth: string
  videoHeight: string
  videoFps: string
  videoQrRecovery: "low" | "medium" | "high" | "highest"
  videoQrSize: string
  videoTileModule: string
  videoTileRs: string
}

const initialOlcrtc: OlcrtcState = {
  provider: "jitsi",
  roomId: "",
  cryptoKey: "",
  dns: "1.1.1.1:53",
  transport: "datachannel",
  vp8Fps: "30",
  vp8Batch: "64",
  seiFps: "30",
  seiBatch: "64",
  seiFrag: "900",
  seiAck: "2000",
  videoCodec: "qrcode",
  videoWidth: "1080",
  videoHeight: "1080",
  videoFps: "30",
  videoQrRecovery: "low",
  videoQrSize: "0",
  videoTileModule: "4",
  videoTileRs: "0",
}

interface FreeturnState {
  links: string[]
  transport: "tcp" | "udp"
  connectHost: string
  connectPort: string
  obfProfile: "rtpopus" | "rtpopus2" | "rtpopus3" | "none"
  obfKey: string
  obfTiming: string
}

const initialFreeturn: FreeturnState = {
  links: [],
  transport: "tcp",
  connectHost: "127.0.0.1",
  connectPort: "",
  obfProfile: "rtpopus",
  obfKey: "",
  obfTiming: "",
}

// parseCoreConfig reverses buildCoreConfig — used to pre-fill the form when
// editing an already-provisioned profile. Reads defensively (every field
// optional-chained with a fallback to the matching initial* default) since
// a profile provisioned by an older version of this form may be missing
// fields a newer one added.
function parseCoreConfig(
  coreType: CoreType,
  raw: string
): { tn: TurnableState; oc: OlcrtcState; ft: FreeturnState } {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = raw ? JSON.parse(raw) : {}
  } catch {
    cfg = {}
  }
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback)
  const num = (v: unknown, fallback: string) =>
    typeof v === "number" ? String(v) : typeof v === "string" ? v : fallback

  if (coreType === "turnable") {
    return {
      tn: {
        connectionType: (str(cfg.connection_type, initialTurnable.connectionType) as TurnableState["connectionType"]),
        platformId: str(cfg.platform_id, initialTurnable.platformId),
        callId: str(cfg.call_id, initialTurnable.callId),
        pubKey: str(cfg.pub_key, initialTurnable.pubKey),
        privKey: str(cfg.priv_key, initialTurnable.privKey),
        proto: (str(cfg.proto, initialTurnable.proto) as TurnableState["proto"]),
        encryption: (str(cfg.encryption, initialTurnable.encryption) as TurnableState["encryption"]),
        routeHost: str(cfg.route_addr, initialTurnable.routeHost),
        routePort: num(cfg.route_port, initialTurnable.routePort),
        routeSocket: (str(cfg.route_socket, initialTurnable.routeSocket) as TurnableState["routeSocket"]),
        routeTransport: (str(cfg.route_transport, initialTurnable.routeTransport) as TurnableState["routeTransport"]),
        peers: num(cfg.peers, initialTurnable.peers),
      },
      oc: initialOlcrtc,
      ft: initialFreeturn,
    }
  }
  if (coreType === "olcrtc") {
    const vp8 = (cfg.vp8 as Record<string, unknown>) ?? {}
    const sei = (cfg.sei as Record<string, unknown>) ?? {}
    const video = (cfg.video as Record<string, unknown>) ?? {}
    return {
      tn: initialTurnable,
      oc: {
        provider: (str(cfg.provider, initialOlcrtc.provider) as OlcrtcState["provider"]),
        roomId: str(cfg.room_id, initialOlcrtc.roomId),
        cryptoKey: str(cfg.crypto_key, initialOlcrtc.cryptoKey),
        dns: str(cfg.dns, initialOlcrtc.dns),
        transport: (str(cfg.transport, initialOlcrtc.transport) as OlcrtcState["transport"]),
        vp8Fps: num(vp8.fps, initialOlcrtc.vp8Fps),
        vp8Batch: num(vp8.batch_size, initialOlcrtc.vp8Batch),
        seiFps: num(sei.fps, initialOlcrtc.seiFps),
        seiBatch: num(sei.batch_size, initialOlcrtc.seiBatch),
        seiFrag: num(sei.fragment_size, initialOlcrtc.seiFrag),
        seiAck: num(sei.ack_timeout_ms, initialOlcrtc.seiAck),
        videoCodec: (str(video.codec, initialOlcrtc.videoCodec) as OlcrtcState["videoCodec"]),
        videoWidth: num(video.width, initialOlcrtc.videoWidth),
        videoHeight: num(video.height, initialOlcrtc.videoHeight),
        videoFps: num(video.fps, initialOlcrtc.videoFps),
        videoQrRecovery: (str(video.qr_recovery, initialOlcrtc.videoQrRecovery) as OlcrtcState["videoQrRecovery"]),
        videoQrSize: num(video.qr_size, initialOlcrtc.videoQrSize),
        videoTileModule: num(video.tile_module, initialOlcrtc.videoTileModule),
        videoTileRs: num(video.tile_rs, initialOlcrtc.videoTileRs),
      },
      ft: initialFreeturn,
    }
  }
  // freeturn
  const links = Array.isArray(cfg.links) ? cfg.links.filter((l): l is string => typeof l === "string") : initialFreeturn.links
  return {
    tn: initialTurnable,
    oc: initialOlcrtc,
    ft: {
      links,
      transport: (str(cfg.transport, initialFreeturn.transport) as FreeturnState["transport"]),
      connectHost: str(cfg.connect_host, initialFreeturn.connectHost),
      connectPort: num(cfg.connect_port, initialFreeturn.connectPort),
      obfProfile: (str(cfg.obf_profile, initialFreeturn.obfProfile) as FreeturnState["obfProfile"]),
      obfKey: str(cfg.obf_key, initialFreeturn.obfKey),
      obfTiming: str(cfg.obf_timing, initialFreeturn.obfTiming),
    },
  }
}

function buildCoreConfig(
  coreType: CoreType,
  tn: TurnableState,
  oc: OlcrtcState,
  ft: FreeturnState
): unknown {
  if (coreType === "turnable") {
    return {
      connection_type: tn.connectionType,
      platform_id: tn.platformId,
      call_id: tn.callId,
      pub_key: tn.pubKey,
      priv_key: tn.privKey,
      proto: tn.proto,
      encryption: tn.encryption,
      route_addr: tn.routeHost,
      route_port: Number(tn.routePort),
      route_socket: tn.routeSocket,
      route_transport: tn.routeTransport,
      peers: Number(tn.peers) || 10,
    }
  }
  if (coreType === "olcrtc") {
    return {
      provider: oc.provider,
      room_id: oc.roomId,
      crypto_key: oc.cryptoKey,
      dns: oc.dns,
      transport: oc.transport,
      ...(oc.transport === "vp8channel" && {
        vp8: { fps: Number(oc.vp8Fps) || 30, batch_size: Number(oc.vp8Batch) || 64 },
      }),
      ...(oc.transport === "seichannel" && {
        sei: {
          fps: Number(oc.seiFps) || 30,
          batch_size: Number(oc.seiBatch) || 64,
          fragment_size: Number(oc.seiFrag) || 900,
          ack_timeout_ms: Number(oc.seiAck) || 2000,
        },
      }),
      ...(oc.transport === "videochannel" && {
        video: {
          codec: oc.videoCodec,
          width: Number(oc.videoWidth) || 1080,
          height: Number(oc.videoHeight) || 1080,
          fps: Number(oc.videoFps) || 30,
          qr_recovery: oc.videoQrRecovery,
          qr_size: Number(oc.videoQrSize) || 0,
          ...(oc.videoCodec === "tile" && {
            tile_module: Number(oc.videoTileModule) || 4,
            tile_rs: Number(oc.videoTileRs) || 0,
          }),
        },
      }),
    }
  }
  // freeturn
  return {
    provider: "vk",
    links: ft.links,
    transport: ft.transport,
    connect_host: ft.connectHost,
    connect_port: Number(ft.connectPort),
    obf_profile: ft.obfProfile,
    ...(ft.obfKey && { obf_key: ft.obfKey }),
    ...(ft.obfTiming && { obf_timing: ft.obfTiming }),
  }
}

// inferRouteSocket figures out whether picking this inbound should set
// Turnable's own route socket to "udp" or "tcp" — hysteria2/wireguard are
// always UDP-based; vless/trojan depend on their configured stream
// transport (mKCP rides on UDP, everything else here — raw tcp, ws, grpc,
// http-upgrade, xhttp — rides on TCP). Best-effort: an unparsable
// StreamSettings blob just falls back to tcp rather than guessing wrong in
// the other, noisier direction (silently forcing udp).
function inferRouteSocket(inbound: XrayInbound): "udp" | "tcp" {
  if (inbound.Protocol === "hysteria2" || inbound.Protocol === "wireguard") return "udp"
  try {
    const stream = JSON.parse(inbound.StreamSettings || "{}") as { network?: string }
    if (stream.network === "kcp") return "udp"
  } catch {
    // fall through to the tcp default
  }
  return "tcp"
}

export interface ProfileFormInitialValues {
  name: string
  coreType: CoreType
  coreConfigRaw: string // "" for a brand new profile
  xrayEnabled: boolean
  xrayInboundId: number | null
  xrayManualUri: string
  xrayManualWireGuard: string
  xrayDualRoute: boolean
  xrayDirectAddress: string
  xrayHcInterval: string
  xrayMux: string
}

export interface ProfileSubmitPayload {
  name: string
  coreType: CoreType
  coreConfig: unknown
  xrayEnabled: boolean
  xrayInboundId: number | null
  xrayManualUri: string
  xrayManualWireGuard: string
  xrayDualRoute: boolean
  xrayDirectAddress: string
  xrayHcInterval: string
  xrayMux: string
}

export const emptyProfileFormValues: ProfileFormInitialValues = {
  name: "",
  coreType: "turnable",
  coreConfigRaw: "",
  xrayEnabled: false,
  xrayInboundId: null,
  xrayManualUri: "",
  xrayManualWireGuard: "",
  xrayDualRoute: false,
  xrayDirectAddress: "",
  xrayHcInterval: "",
  xrayMux: "",
}

// ProfileForm is the shared body used by both AddProfileDialog (mode
// "create") and EditProfileDialog (mode "edit") — everything from the
// profile name down to the xray overlay. In edit mode the core type can't
// change (the backend rejects it — see handlers_profiles.go's
// updateProfile), so that selector is disabled rather than hidden: seeing
// which kernel a profile uses is still useful context while editing it.
export function ProfileForm({
  mode,
  initialValues,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  mode: "create" | "edit"
  initialValues: ProfileFormInitialValues
  submitLabel: string
  submittingLabel: string
  onSubmit: (payload: ProfileSubmitPayload) => Promise<void>
}) {
  const [name, setName] = React.useState(initialValues.name)
  const [coreType, setCoreType] = React.useState<CoreType>(initialValues.coreType)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const parsed = React.useMemo(
    () => parseCoreConfig(initialValues.coreType, initialValues.coreConfigRaw),
    [initialValues.coreType, initialValues.coreConfigRaw]
  )
  const [tn, setTn] = React.useState<TurnableState>(parsed.tn)
  const [oc, setOc] = React.useState<OlcrtcState>(parsed.oc)
  const [ft, setFt] = React.useState<FreeturnState>(parsed.ft)

  const [xrayEnabled, setXrayEnabled] = React.useState(initialValues.xrayEnabled)
  const [inbounds, setInbounds] = React.useState<XrayInbound[]>([])
  const [xrayInboundId, setXrayInboundId] = React.useState(
    initialValues.xrayInboundId ? String(initialValues.xrayInboundId) : ""
  )
  const [xrayManualUri, setXrayManualUri] = React.useState(initialValues.xrayManualUri)
  const [xrayManualWireGuard, setXrayManualWireGuard] = React.useState(initialValues.xrayManualWireGuard)
  // Purely a UI toggle (never sent as-is) — which of the two manual
  // fallbacks is currently shown when no inbound is picked. Starts on
  // whichever one actually has saved content, so editing a profile with an
  // existing WG config opens on that tab instead of defaulting to URI.
  const [xrayManualMode, setXrayManualMode] = React.useState<"uri" | "wireguard">(
    initialValues.xrayManualWireGuard ? "wireguard" : "uri"
  )
  const [xrayDualRoute, setXrayDualRoute] = React.useState(initialValues.xrayDualRoute)
  const [xrayDirectAddress, setXrayDirectAddress] = React.useState(initialValues.xrayDirectAddress)
  const [xrayHcInterval, setXrayHcInterval] = React.useState(initialValues.xrayHcInterval)
  const [xrayMux, setXrayMux] = React.useState(initialValues.xrayMux)

  const vkRooms = useCallRooms("vk")
  const vkRoomOptions: ComboboxOption[] = vkRooms.map((r) => ({
    value: r.RoomID,
    label: r.Label ? `${r.Label} — ${r.RoomID}` : r.RoomID,
  }))
  const olcrtcRooms = useCallRooms(oc.provider)
  const olcrtcRoomOptions: ComboboxOption[] = olcrtcRooms.map((r) => ({
    value: r.RoomID,
    label: r.Label ? `${r.Label} — ${r.RoomID}` : r.RoomID,
  }))

  React.useEffect(() => {
    api.listXrayInbounds().then(setInbounds).catch(() => setInbounds([]))
  }, [])

  function handlePickInbound(id: string) {
    setXrayInboundId(id)
    const inbound = inbounds.find((i) => String(i.ID) === id)
    if (!inbound) return
    // The kernel forwards its decrypted traffic to a local port — point it
    // straight at the inbound we just picked so operators don't have to
    // copy the port over by hand. For Turnable this also means the route
    // socket/transport pair has to actually match how the inbound listens
    // (see inferRouteSocket) — picking a UDP-based inbound (hysteria2,
    // wireguard, or vless/trojan over mKCP) while route socket stayed on
    // its old "tcp" value would silently forward to the wrong socket type.
    if (coreType === "turnable") {
      const routeSocket = inferRouteSocket(inbound)
      setTn((s) => ({
        ...s,
        routeHost: "127.0.0.1",
        routePort: String(inbound.Port),
        routeSocket,
        routeTransport: routeSocket === "udp" ? "none" : "kcp",
      }))
    } else if (coreType === "freeturn") {
      setFt((s) => ({ ...s, connectHost: "127.0.0.1", connectPort: String(inbound.Port) }))
    }
  }

  // Turnable/FreeTurn additionally get a WireGuard-config manual fallback
  // (a raw [Interface]/[Peer] blob, not a single-line URI — see
  // xrayManualWireGuard) alongside the plain URI one; olcRTC keeps URI-only.
  const supportsWireGuardManual = coreType === "turnable" || coreType === "freeturn"

  // FreeTurn only ever forwards over UDP (its own -connect target has to be
  // a UDP listener) — vless/trojan inbounds are typically TCP-based, so
  // only hysteria2/wireguard ones are real forwarding targets here. olcRTC
  // is the opposite restriction: it has no WireGuard-compatible transport
  // of its own, so a wireguard inbound is never a valid pick for it.
  const visibleInbounds =
    coreType === "freeturn"
      ? inbounds.filter((ib) => ib.Protocol === "hysteria2" || ib.Protocol === "wireguard")
      : coreType === "olcrtc"
        ? inbounds.filter((ib) => ib.Protocol !== "wireguard")
        : inbounds

  // Dual Route (docs/subscriptions.md §3) only applies to the VLESS-mode
  // overlay (vless/trojan/hysteria2 link) — WireGuard mode has no
  // equivalent, so hide the controls whenever the resolved overlay is
  // WireGuard, whether that comes from picking a wireguard inbound or from
  // the manual WireGuard-config fallback.
  const selectedInbound = inbounds.find((ib) => String(ib.ID) === xrayInboundId)
  const isWireGuardOverlay = xrayInboundId
    ? selectedInbound?.Protocol === "wireguard"
    : supportsWireGuardManual && xrayManualMode === "wireguard"
  const showDualRoute = xrayEnabled && !isWireGuardOverlay

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const manualUri = xrayEnabled && !xrayInboundId && xrayManualMode === "uri" ? xrayManualUri : ""
      const manualWg =
        xrayEnabled && !xrayInboundId && supportsWireGuardManual && xrayManualMode === "wireguard"
          ? xrayManualWireGuard
          : ""
      await onSubmit({
        name,
        coreType,
        coreConfig: buildCoreConfig(coreType, tn, oc, ft),
        xrayEnabled,
        xrayInboundId: xrayEnabled && xrayInboundId ? Number(xrayInboundId) : null,
        xrayManualUri: manualUri,
        xrayManualWireGuard: manualWg,
        xrayDualRoute: showDualRoute && xrayDualRoute,
        xrayDirectAddress: showDualRoute && xrayDualRoute ? xrayDirectAddress : "",
        xrayHcInterval: showDualRoute && xrayDualRoute ? xrayHcInterval : "",
        xrayMux: showDualRoute && xrayDualRoute ? xrayMux : "",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить профиль")
    } finally {
      setLoading(false)
    }
  }

  // xrayBlock sits above the "Маршрут"/"-connect" box for Turnable/FreeTurn.
  const xrayBlock = (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="xray-enabled">Xray-оверлей (VLESS/Trojan/Hysteria2/WireGuard)</Label>
        <Switch id="xray-enabled" checked={xrayEnabled} onCheckedChange={setXrayEnabled} />
      </div>
      {xrayEnabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="xray-inbound">Инбаунд</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Select value={xrayInboundId} onValueChange={handlePickInbound}>
                  <SelectTrigger id="xray-inbound" className="w-full">
                    <SelectValue placeholder="Выбрать из настроенных на странице Xray..." />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleInbounds.map((ib) => (
                      <SelectItem key={ib.ID} value={String(ib.ID)}>
                        {ib.Remark} — {ib.Protocol} :{ib.Port}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Picking an inbound used to be a one-way door — nothing
                  ever cleared xrayInboundId back to "", so the manual
                  fallback below stayed hidden forever after. */}
              {xrayInboundId && (
                <Button type="button" variant="outline" size="sm" onClick={() => setXrayInboundId("")}>
                  Сбросить
                </Button>
              )}
            </div>
            {coreType === "freeturn" && (
              <p className="text-xs text-muted-foreground">
                FreeTurn форвардит только по UDP — доступны инбаунды Hysteria2 и WireGuard.
              </p>
            )}
            {coreType === "olcrtc" && (
              <p className="text-xs text-muted-foreground">
                У olcRTC нет транспорта, совместимого с WireGuard — такие инбаунды здесь не предлагаются.
              </p>
            )}
            {(coreType === "turnable" || coreType === "freeturn") && xrayInboundId && (
              <p className="text-xs text-muted-foreground">
                Маршрут ниже выставлен автоматически на этот инбаунд (127.0.0.1).
              </p>
            )}
          </div>
          {!xrayInboundId && (
            <div className="flex flex-col gap-2">
              {supportsWireGuardManual && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={xrayManualMode === "uri" ? "default" : "outline"}
                    onClick={() => setXrayManualMode("uri")}
                  >
                    URI
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={xrayManualMode === "wireguard" ? "default" : "outline"}
                    onClick={() => setXrayManualMode("wireguard")}
                  >
                    WireGuard-конфиг
                  </Button>
                </div>
              )}
              {(!supportsWireGuardManual || xrayManualMode === "uri") && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="xray-manual-uri">Укажите готовый URI вручную</Label>
                  <Input
                    id="xray-manual-uri"
                    value={xrayManualUri}
                    onChange={(e) => setXrayManualUri(e.target.value)}
                    placeholder={coreType === "freeturn" ? "hysteria2://..." : "vless://... или trojan://... или hysteria2://..."}
                  />
                </div>
              )}
              {supportsWireGuardManual && xrayManualMode === "wireguard" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="xray-manual-wg">WireGuard-конфиг</Label>
                  <Textarea
                    id="xray-manual-wg"
                    value={xrayManualWireGuard}
                    onChange={(e) => setXrayManualWireGuard(e.target.value)}
                    rows={6}
                    className="font-mono text-xs"
                    placeholder={"[Interface]\nPrivateKey = ...\nAddress = ...\n\n[Peer]\nPublicKey = ...\nEndpoint = ...\nAllowedIPs = ..."}
                  />
                </div>
              )}
            </div>
          )}
          {showDualRoute && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="xray-dual-route">Dual Route (прямое подключение с фолбэком на туннель)</Label>
                <Switch id="xray-dual-route" checked={xrayDualRoute} onCheckedChange={setXrayDualRoute} />
              </div>
              {xrayDualRoute && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="xray-direct-address">Прямой адрес (host:port)</Label>
                    <Input
                      id="xray-direct-address"
                      value={xrayDirectAddress}
                      onChange={(e) => setXrayDirectAddress(e.target.value)}
                      placeholder="1.2.3.4:443"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="xray-hc-interval">Интервал health-check, сек</Label>
                      <Input
                        id="xray-hc-interval"
                        type="number"
                        value={xrayHcInterval}
                        onChange={(e) => setXrayHcInterval(e.target.value)}
                        placeholder="30"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="xray-mux">Mux (потоков)</Label>
                      <Input
                        id="xray-mux"
                        type="number"
                        value={xrayMux}
                        onChange={(e) => setXrayMux(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-name">Имя профиля</Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Ядро</Label>
        <Select
          value={coreType}
          onValueChange={(v) => setCoreType(v as CoreType)}
          disabled={mode === "edit"}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CORE_LABELS) as (keyof typeof CORE_LABELS)[]).map((ct) => (
              <SelectItem key={ct} value={ct}>
                {CORE_LABELS[ct]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "edit" && (
          <p className="text-xs text-muted-foreground">
            Нельзя сменить ядро существующего профиля — удалите и создайте заново.
          </p>
        )}
      </div>

      {coreType === "turnable" && (
        <>
          <div className="flex flex-col gap-2">
            <Label>Тип подключения</Label>
            <Select
              value={tn.connectionType}
              onValueChange={(v) => setTn({ ...tn, connectionType: v as TurnableState["connectionType"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relay">Relay (рекомендуется)</SelectItem>
                <SelectItem value="direct">Direct (не рекомендуется, небезопасно)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Протокол</Label>
            <Select value={tn.proto} onValueChange={(v) => setTn({ ...tn, proto: v as TurnableState["proto"] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="srtp">SRTP (рекомендуется)</SelectItem>
                <SelectItem value="dtls">DTLS</SelectItem>
                <SelectItem value="none">None (не рекомендуется, опасно)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Платформа</Label>
            <Select value={tn.platformId} onValueChange={(v) => setTn({ ...tn, platformId: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vk.com">vk.com</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="peers">Peers (параллельных соединений)</Label>
            <Input
              id="peers"
              type="number"
              min={1}
              value={tn.peers}
              onChange={(e) => setTn({ ...tn, peers: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="call-id">ID звонка</Label>
            <Combobox
              id="call-id"
              options={vkRoomOptions}
              value={tn.callId}
              onChange={(v) => setTn({ ...tn, callId: v })}
              placeholder="ABC123xyz... или выбрать из журнала комнат"
              required
            />
            <VkCallHint />
          </div>

          {xrayBlock}

          <div className="rounded-md border p-3">
            <p className="mb-3 text-sm font-medium">Маршрут (куда форвардить трафик)</p>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="route-host">Хост</Label>
                  <Input
                    id="route-host"
                    value={tn.routeHost}
                    onChange={(e) => setTn({ ...tn, routeHost: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="route-port">Порт</Label>
                  <Input
                    id="route-port"
                    type="number"
                    value={tn.routePort}
                    onChange={(e) => setTn({ ...tn, routePort: e.target.value })}
                    required
                    placeholder="51820"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label>Тип сокета</Label>
                  <Select
                    value={tn.routeSocket}
                    onValueChange={(v) => {
                      const routeSocket = v as TurnableState["routeSocket"]
                      setTn({ ...tn, routeSocket, routeTransport: routeSocket === "udp" ? "none" : "kcp" })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="udp">UDP</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Транспорт</Label>
                  <Select
                    value={tn.routeTransport}
                    onValueChange={(v) => setTn({ ...tn, routeTransport: v as TurnableState["routeTransport"] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (для UDP)</SelectItem>
                      <SelectItem value="kcp">KCP (для TCP)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Шифрование</Label>
            <Select
              value={tn.encryption}
              onValueChange={(v) => setTn({ ...tn, encryption: v as TurnableState["encryption"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="handshake">Handshake (рекомендуется, быстрее)</SelectItem>
                <SelectItem value="full">Full (шифрует весь трафик)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <KeyField
            id="pub-key"
            label="Публичный ключ (pub_key)"
            value={tn.pubKey}
            onChange={(v) => setTn({ ...tn, pubKey: v })}
            onGenerate={() =>
              api.keygenTurnable().then(({ pubKey, privKey }) =>
                setTn((s) => ({ ...s, pubKey, privKey }))
              )
            }
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="priv-key">Приватный ключ (priv_key)</Label>
            <Input
              id="priv-key"
              value={tn.privKey}
              onChange={(e) => setTn({ ...tn, privKey: e.target.value })}
              placeholder="заполняется вместе с публичным ключом"
              className="font-mono text-xs"
            />
          </div>
        </>
      )}

      {coreType === "olcrtc" && (
        <>
          <div className="flex flex-col gap-2">
            <Label>Провайдер</Label>
            <Select
              value={oc.provider}
              onValueChange={(v) => setOc({ ...oc, provider: v as OlcrtcState["provider"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jitsi">Jitsi</SelectItem>
                <SelectItem value="telemost">Телемост</SelectItem>
                <SelectItem value="wbstream">WB Stream</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-id">
              {oc.provider === "jitsi" ? "URL комнаты (https://.../room)" : "ID комнаты"}
            </Label>
            <Combobox
              id="room-id"
              options={olcrtcRoomOptions}
              value={oc.roomId}
              onChange={(v) => setOc({ ...oc, roomId: v })}
              placeholder={oc.provider === "jitsi" ? "https://meet.example.org/myroom" : ""}
              required
            />
          </div>

          <KeyField
            id="crypto-key"
            label="Ключ шифрования (crypto.key)"
            value={oc.cryptoKey}
            onChange={(v) => setOc({ ...oc, cryptoKey: v })}
            onGenerate={() => api.keygenHex32().then(({ key }) => setOc((s) => ({ ...s, cryptoKey: key })))}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="dns">DNS</Label>
            <Input id="dns" value={oc.dns} onChange={(e) => setOc({ ...oc, dns: e.target.value })} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Транспорт</Label>
            <Select
              value={oc.transport}
              onValueChange={(v) => setOc({ ...oc, transport: v as OlcrtcState["transport"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="datachannel">DataChannel</SelectItem>
                <SelectItem value="vp8channel">VP8Channel</SelectItem>
                <SelectItem value="seichannel">SEIChannel</SelectItem>
                <SelectItem value="videochannel">VideoChannel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {oc.transport === "vp8channel" && (
            <AdvancedFields>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="vp8-fps">FPS</Label>
                  <Input id="vp8-fps" type="number" value={oc.vp8Fps} onChange={(e) => setOc({ ...oc, vp8Fps: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="vp8-batch">Batch size</Label>
                  <Input id="vp8-batch" type="number" value={oc.vp8Batch} onChange={(e) => setOc({ ...oc, vp8Batch: e.target.value })} />
                </div>
              </div>
            </AdvancedFields>
          )}

          {oc.transport === "seichannel" && (
            <AdvancedFields>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-fps">FPS</Label>
                  <Input id="sei-fps" type="number" value={oc.seiFps} onChange={(e) => setOc({ ...oc, seiFps: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-batch">Batch size</Label>
                  <Input id="sei-batch" type="number" value={oc.seiBatch} onChange={(e) => setOc({ ...oc, seiBatch: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-frag">Fragment size</Label>
                  <Input id="sei-frag" type="number" value={oc.seiFrag} onChange={(e) => setOc({ ...oc, seiFrag: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-ack">ACK timeout, мс</Label>
                  <Input id="sei-ack" type="number" value={oc.seiAck} onChange={(e) => setOc({ ...oc, seiAck: e.target.value })} />
                </div>
              </div>
            </AdvancedFields>
          )}

          {oc.transport === "videochannel" && (
            <AdvancedFields>
              <div className="flex flex-col gap-2">
                <Label>Кодек</Label>
                <Select
                  value={oc.videoCodec}
                  onValueChange={(v) => setOc({ ...oc, videoCodec: v as OlcrtcState["videoCodec"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qrcode">QR-код</SelectItem>
                    <SelectItem value="tile">Tile</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="video-width">Ширина</Label>
                  <Input id="video-width" type="number" value={oc.videoWidth} onChange={(e) => setOc({ ...oc, videoWidth: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="video-height">Высота</Label>
                  <Input id="video-height" type="number" value={oc.videoHeight} onChange={(e) => setOc({ ...oc, videoHeight: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="video-fps">FPS</Label>
                  <Input id="video-fps" type="number" value={oc.videoFps} onChange={(e) => setOc({ ...oc, videoFps: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Коррекция QR</Label>
                  <Select
                    value={oc.videoQrRecovery}
                    onValueChange={(v) => setOc({ ...oc, videoQrRecovery: v as OlcrtcState["videoQrRecovery"] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="highest">Highest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {oc.videoCodec === "tile" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="video-tile-module">Tile module</Label>
                    <Input id="video-tile-module" type="number" value={oc.videoTileModule} onChange={(e) => setOc({ ...oc, videoTileModule: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="video-tile-rs">Tile RS, %</Label>
                    <Input id="video-tile-rs" type="number" value={oc.videoTileRs} onChange={(e) => setOc({ ...oc, videoTileRs: e.target.value })} />
                  </div>
                </div>
              )}
            </AdvancedFields>
          )}
        </>
      )}

      {coreType === "freeturn" && (
        <>
          <div className="flex flex-col gap-2">
            <Label>ID звонков</Label>
            <MultiSelect
              options={vkRoomOptions}
              value={ft.links}
              onChange={(v) => setFt({ ...ft, links: v })}
              placeholder="ABC123xyz... или выбрать из журнала комнат"
            />
            <VkCallHint />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Транспорт (до TURN-сервера)</Label>
            <Select
              value={ft.transport}
              onValueChange={(v) => setFt({ ...ft, transport: v as FreeturnState["transport"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {xrayBlock}

          <div className="rounded-md border p-3">
            <p className="mb-3 text-sm font-medium">Куда форвардить трафик (-connect)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="connect-host">Хост</Label>
                <Input
                  id="connect-host"
                  value={ft.connectHost}
                  onChange={(e) => setFt({ ...ft, connectHost: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="connect-port">Порт</Label>
                <Input
                  id="connect-port"
                  type="number"
                  value={ft.connectPort}
                  onChange={(e) => setFt({ ...ft, connectPort: e.target.value })}
                  required
                  placeholder="51820"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Профиль обфускации (-obf-profile)</Label>
            <Select
              value={ft.obfProfile}
              onValueChange={(v) => setFt({ ...ft, obfProfile: v as FreeturnState["obfProfile"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rtpopus">rtpopus (рекомендуется)</SelectItem>
                <SelectItem value="rtpopus2">rtpopus2</SelectItem>
                <SelectItem value="rtpopus3">rtpopus3</SelectItem>
                <SelectItem value="none">None (без маскировки)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {ft.obfProfile !== "none" && (
            <KeyField
              id="obf-key"
              label="Ключ обфускации (-obf-key)"
              value={ft.obfKey}
              onChange={(v) => setFt({ ...ft, obfKey: v })}
              onGenerate={() => api.keygenHex32().then(({ key }) => setFt((s) => ({ ...s, obfKey: key })))}
            />
          )}

          {ft.obfProfile !== "none" && (
            <AdvancedFields>
              <div className="flex flex-col gap-2">
                <Label htmlFor="obf-timing">Межпакетная задержка (-obf-timing)</Label>
                <Input
                  id="obf-timing"
                  value={ft.obfTiming}
                  onChange={(e) => setFt({ ...ft, obfTiming: e.target.value })}
                  placeholder="например, 10ms — пусто = выключено"
                />
                <p className="text-xs text-muted-foreground">
                  Добавляет задержку между пакетами, имитируя тайминг настоящего
                  RTP/Opus-потока (кодеки шлют кадр раз в ~20мс) — усложняет
                  обнаружение по паттерну таймингов. Не обязательно.
                </p>
              </div>
            </AdvancedFields>
          )}
        </>
      )}

      {coreType === "olcrtc" && xrayBlock}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={loading}>
          {loading ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
