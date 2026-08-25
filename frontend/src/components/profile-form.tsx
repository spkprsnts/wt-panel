import * as React from "react"

import { useT } from "@/lib/i18n"
import type { TranslationKey } from "@/i18n"
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

const CORE_LABELS: Record<CoreType, TranslationKey> = {
  turnable: "profileForm.core.turnable",
  olcrtc: "profileForm.core.olcrtc",
  freeturn: "profileForm.core.freeturn",
  webdav: "profileForm.core.webdav",
}

// Turnable/FreeTurn have no transport of their own that survives on the
// public internet without help (raw TURN/relay traffic is trivially
// fingerprinted) — the Xray overlay is how a profile actually gets real
// protocol camouflage, so a brand-new profile of either core defaults to
// having it on. olcRTC/WebDAV are SOCKS5-native and only use the overlay
// for the optional Dual Route fallback, so they default to off.
function defaultXrayEnabledForCore(ct: CoreType): boolean {
  return ct === "turnable" || ct === "freeturn"
}

// olcRTC's room id/URL hints reuse the same rooms.hint.* copy the Call
// Rooms journal already shows per provider — same field, same providers
// (minus "vk", which olcRTC never uses), so no reason to duplicate the text.
const OLCRTC_ROOM_ID_HINT_KEYS: Record<OlcrtcState["provider"], TranslationKey> = {
  jitsi: "rooms.hint.jitsi",
  telemost: "rooms.hint.telemost",
  wbstream: "rooms.hint.wbstream",
}

// useCallRooms feeds the "Call rooms" journal into whichever combobox
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
  const t = useT()
  return (
    <p className="text-xs text-muted-foreground">
      {t("profileForm.vkHint.line1")} <code>vk.com/call/join/ABC123xyz...</code> —{" "}
      {t("profileForm.vkHint.line1b")} <code>/join/</code>.
      <br />
      {t("profileForm.vkHint.line2")} <code>"https://vk.com/call/join/"</code>
      {t("profileForm.vkHint.line2b")}
    </p>
  )
}

function AdvancedFields({ label, children }: { label?: string; children: React.ReactNode }) {
  const t = useT()
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium text-muted-foreground">
        {label ?? t("profileForm.advancedSettings")}
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
  const t = useT()
  const [generating, setGenerating] = React.useState(false)
  const [genError, setGenError] = React.useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      await onGenerate()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t("profileForm.keyField.generateFailed"))
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
          placeholder={placeholder ?? t("profileForm.keyField.placeholder")}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? "..." : t("profileForm.keyField.generate")}
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
  port: string
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
  port: "",
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
  proxyUpstream: string
  // authToken only applies to provider "wbstream" — a pre-issued account
  // token enabling moderator features (datachannel publishing).
  authToken: string
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
  // Empty means "let olcrtc apply its own default for this field" — same
  // convention as WebdavTuning below, not a real value of its own.
  livenessInterval: string
  livenessTimeout: string
  livenessFailures: string
  maxSessionDuration: string
}

const initialOlcrtc: OlcrtcState = {
  provider: "jitsi",
  roomId: "",
  cryptoKey: "",
  dns: "1.1.1.1:53",
  proxyUpstream: "",
  authToken: "",
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
  livenessInterval: "",
  livenessTimeout: "",
  livenessFailures: "",
  maxSessionDuration: "",
}

interface FreeturnState {
  links: string[]
  transport: "tcp" | "udp"
  port: string
  connectHost: string
  connectPort: string
  obfProfile: "rtpopus" | "rtpopus2" | "rtpopus3" | "none"
  obfKey: string
  obfTiming: string
}

const initialFreeturn: FreeturnState = {
  links: [],
  transport: "tcp",
  port: "",
  connectHost: "127.0.0.1",
  connectPort: "",
  obfProfile: "rtpopus",
  obfKey: "",
  obfTiming: "",
}

// Login/Password are infra (auto-generated server-side on first save if
// left blank, same as Turnable's pub_key/priv_key) — editable here in case
// the operator wants specific credentials instead. TLSCertFile/TLSKeyFile
// point webdav-tunnel's own built-in TLS straight at cert/key files already
// on the server — no reverse proxy involved.
interface WebdavBackend {
  url: string
  login: string
  password: string
}

// connMode "selfhosted" runs webdav-tunnel's own embedded WebDAV (Login/
// Password/TLS* below apply); "server" instead relays through one or more
// already-existing external WebDAV endpoints (Backends) — see
// docs/config.md upstream. The two are mutually exclusive per profile.
// Tuning fields (docs/tuning.md upstream) — empty string / "0" means "let
// webdav-tunnel apply its own default for this mode" rather than a real
// value: selfhosted auto-applies a faster preset for poll-min/poll-max/
// coalesce, server mode always uses the plain generic defaults unless told
// otherwise. The two quick-fill preset buttons in the UI just populate
// these same fields — there's no separate stored "preset" concept, so
// hand-editing after picking one works exactly like typing values in from
// scratch.
interface WebdavTuning {
  pollMin: string
  pollMax: string
  coalesce: string
  chunkSize: string
  puts: string
  readMin: string
  readMax: string
}

const emptyWebdavTuning: WebdavTuning = {
  pollMin: "",
  pollMax: "",
  coalesce: "",
  chunkSize: "",
  puts: "",
  readMin: "",
  readMax: "",
}

const WEBDAV_TUNING_PRESETS: Record<"selfhosted" | "server", WebdavTuning> = {
  selfhosted: { pollMin: "50ms", pollMax: "200ms", coalesce: "5ms", chunkSize: "131071", puts: "8", readMin: "3", readMax: "8" },
  server: { pollMin: "200ms", pollMax: "500ms", coalesce: "10ms", chunkSize: "131071", puts: "8", readMin: "3", readMax: "8" },
}

interface WebdavState {
  connMode: "selfhosted" | "server"
  login: string
  password: string
  port: string
  proxyUpstream: string
  enc: boolean
  tlsCertFile: string
  tlsKeyFile: string
  dns: string
  backends: WebdavBackend[]
  tuning: WebdavTuning
}

const initialWebdav: WebdavState = {
  connMode: "selfhosted",
  login: "",
  password: "",
  port: "",
  proxyUpstream: "",
  enc: false,
  tlsCertFile: "",
  tlsKeyFile: "",
  dns: "",
  backends: [{ url: "", login: "", password: "" }],
  tuning: emptyWebdavTuning,
}

// parseCoreConfig reverses buildCoreConfig — used to pre-fill the form when
// editing an already-provisioned profile. Reads defensively (every field
// optional-chained with a fallback to the matching initial* default) since
// a profile provisioned by an older version of this form may be missing
// fields a newer one added.
function parseCoreConfig(
  coreType: CoreType,
  raw: string
): { tn: TurnableState; oc: OlcrtcState; ft: FreeturnState; wd: WebdavState } {
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
        port: num(cfg.port, initialTurnable.port),
        routeHost: str(cfg.route_addr, initialTurnable.routeHost),
        routePort: num(cfg.route_port, initialTurnable.routePort),
        routeSocket: (str(cfg.route_socket, initialTurnable.routeSocket) as TurnableState["routeSocket"]),
        routeTransport: (str(cfg.route_transport, initialTurnable.routeTransport) as TurnableState["routeTransport"]),
        peers: num(cfg.peers, initialTurnable.peers),
      },
      oc: initialOlcrtc,
      ft: initialFreeturn,
      wd: initialWebdav,
    }
  }
  if (coreType === "olcrtc") {
    const vp8 = (cfg.vp8 as Record<string, unknown>) ?? {}
    const sei = (cfg.sei as Record<string, unknown>) ?? {}
    const video = (cfg.video as Record<string, unknown>) ?? {}
    const liveness = (cfg.liveness as Record<string, unknown>) ?? {}
    return {
      tn: initialTurnable,
      oc: {
        provider: (str(cfg.provider, initialOlcrtc.provider) as OlcrtcState["provider"]),
        roomId: str(cfg.room_id, initialOlcrtc.roomId),
        cryptoKey: str(cfg.crypto_key, initialOlcrtc.cryptoKey),
        dns: str(cfg.dns, initialOlcrtc.dns),
        proxyUpstream: str(cfg.proxy_upstream, initialOlcrtc.proxyUpstream),
        authToken: str(cfg.auth_token, initialOlcrtc.authToken),
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
        livenessInterval: str(liveness.interval, initialOlcrtc.livenessInterval),
        livenessTimeout: str(liveness.timeout, initialOlcrtc.livenessTimeout),
        livenessFailures: num(liveness.failures, initialOlcrtc.livenessFailures),
        maxSessionDuration: str(cfg.max_session_duration, initialOlcrtc.maxSessionDuration),
      },
      ft: initialFreeturn,
      wd: initialWebdav,
    }
  }
  if (coreType === "webdav") {
    const rawBackends = Array.isArray(cfg.backends) ? cfg.backends : []
    const backends = rawBackends
      .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
      .map((b) => ({
        url: str(b.url, ""),
        login: str(b.login, ""),
        password: str(b.password, ""),
      }))
    return {
      tn: initialTurnable,
      oc: initialOlcrtc,
      ft: initialFreeturn,
      wd: {
        connMode: (str(cfg.conn_mode, initialWebdav.connMode) as WebdavState["connMode"]),
        login: str(cfg.login, initialWebdav.login),
        password: str(cfg.password, initialWebdav.password),
        port: num(cfg.port, initialWebdav.port),
        proxyUpstream: str(cfg.proxy_upstream, initialWebdav.proxyUpstream),
        enc: typeof cfg.enc === "boolean" ? cfg.enc : initialWebdav.enc,
        tlsCertFile: str(cfg.tls_cert_file, initialWebdav.tlsCertFile),
        tlsKeyFile: str(cfg.tls_key_file, initialWebdav.tlsKeyFile),
        dns: str(cfg.dns, initialWebdav.dns),
        backends: backends.length > 0 ? backends : initialWebdav.backends,
        tuning: {
          pollMin: str(cfg.poll_min, emptyWebdavTuning.pollMin),
          pollMax: str(cfg.poll_max, emptyWebdavTuning.pollMax),
          coalesce: str(cfg.coalesce, emptyWebdavTuning.coalesce),
          chunkSize: num(cfg.chunk_size, emptyWebdavTuning.chunkSize),
          puts: num(cfg.puts, emptyWebdavTuning.puts),
          readMin: num(cfg.read_min, emptyWebdavTuning.readMin),
          readMax: num(cfg.read_max, emptyWebdavTuning.readMax),
        },
      },
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
      port: num(cfg.port, initialFreeturn.port),
      connectHost: str(cfg.connect_host, initialFreeturn.connectHost),
      connectPort: num(cfg.connect_port, initialFreeturn.connectPort),
      obfProfile: (str(cfg.obf_profile, initialFreeturn.obfProfile) as FreeturnState["obfProfile"]),
      obfKey: str(cfg.obf_key, initialFreeturn.obfKey),
      obfTiming: str(cfg.obf_timing, initialFreeturn.obfTiming),
    },
    wd: initialWebdav,
  }
}

function buildCoreConfig(
  coreType: CoreType,
  tn: TurnableState,
  oc: OlcrtcState,
  ft: FreeturnState,
  wd: WebdavState
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
      ...(Number(tn.port) > 0 && { port: Number(tn.port) }),
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
      ...(oc.proxyUpstream && { proxy_upstream: oc.proxyUpstream }),
      ...(oc.provider === "wbstream" && oc.authToken && { auth_token: oc.authToken }),
      ...((oc.livenessInterval || oc.livenessTimeout || oc.livenessFailures) && {
        liveness: {
          ...(oc.livenessInterval && { interval: oc.livenessInterval }),
          ...(oc.livenessTimeout && { timeout: oc.livenessTimeout }),
          ...(Number(oc.livenessFailures) > 0 && { failures: Number(oc.livenessFailures) }),
        },
      }),
      ...(oc.maxSessionDuration && { max_session_duration: oc.maxSessionDuration }),
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
  if (coreType === "webdav") {
    const t = wd.tuning
    const tuningFields = {
      ...(t.pollMin && { poll_min: t.pollMin }),
      ...(t.pollMax && { poll_max: t.pollMax }),
      ...(t.coalesce && { coalesce: t.coalesce }),
      ...(Number(t.chunkSize) > 0 && { chunk_size: Number(t.chunkSize) }),
      ...(Number(t.puts) > 0 && { puts: Number(t.puts) }),
      ...(Number(t.readMin) > 0 && { read_min: Number(t.readMin) }),
      ...(Number(t.readMax) > 0 && { read_max: Number(t.readMax) }),
    }
    if (wd.connMode === "server") {
      return {
        conn_mode: "server",
        enc: wd.enc,
        ...(wd.dns && { dns: wd.dns }),
        ...(wd.proxyUpstream && { proxy_upstream: wd.proxyUpstream }),
        backends: wd.backends
          .filter((b) => b.url && b.login && b.password)
          .map((b) => ({ url: b.url, login: b.login, password: b.password })),
        ...tuningFields,
      }
    }
    return {
      conn_mode: "selfhosted",
      login: wd.login,
      password: wd.password,
      ...(Number(wd.port) > 0 && { port: Number(wd.port) }),
      ...(wd.proxyUpstream && { proxy_upstream: wd.proxyUpstream }),
      enc: wd.enc,
      ...(wd.tlsCertFile && { tls_cert_file: wd.tlsCertFile }),
      ...(wd.tlsKeyFile && { tls_key_file: wd.tlsKeyFile }),
      ...(wd.dns && { dns: wd.dns }),
      ...tuningFields,
    }
  }
  // freeturn
  return {
    provider: "vk",
    links: ft.links,
    transport: ft.transport,
    ...(Number(ft.port) > 0 && { port: Number(ft.port) }),
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
  enabled: boolean
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
  enabled: boolean
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
  enabled: true,
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
  const t = useT()
  const [name, setName] = React.useState(initialValues.name)
  const [enabled, setEnabled] = React.useState(initialValues.enabled)
  const [coreType, setCoreType] = React.useState<CoreType>(initialValues.coreType)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [webdavPanelCertError, setWebdavPanelCertError] = React.useState<string | null>(null)

  const parsed = React.useMemo(
    () => parseCoreConfig(initialValues.coreType, initialValues.coreConfigRaw),
    [initialValues.coreType, initialValues.coreConfigRaw]
  )
  const [tn, setTn] = React.useState<TurnableState>(parsed.tn)
  const [oc, setOc] = React.useState<OlcrtcState>(parsed.oc)
  const [ft, setFt] = React.useState<FreeturnState>(parsed.ft)
  const [wd, setWd] = React.useState<WebdavState>(parsed.wd)

  const [xrayEnabled, setXrayEnabled] = React.useState(
    mode === "create" ? defaultXrayEnabledForCore(initialValues.coreType) : initialValues.xrayEnabled
  )
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

  // WebDAV selfhosted's own TLS is a plain Go tls.LoadX509KeyPair — the same
  // PEM cert+key format the panel's own http.ListenAndServeTLS needs — so
  // whatever cert the panel already has (Settings → "Panel network",
  // normally a real Let's Encrypt cert from install.sh's SSL setup) works
  // here unmodified, same reasoning as XrayPage's TlsFields.handleUsePanelCert
  // for Hysteria2. Unlike that Hysteria2 case, though, the host WebDAV
  // clients are actually told to connect to (webdav(s)://host:port) is NOT
  // the panel's own ListenDomain — it comes from a wholly separate,
  // env-var-only setting (WTP_WEBDAV_PUBLIC_HOST, resolved via
  // cfg.ResolvedWebDAVPublicHost, falling back to the bare PublicIP — see
  // config.go). If the panel's cert was issued for a domain but that env
  // var isn't ALSO pointed at the same domain, this copies over a cert that
  // will fail hostname verification the moment a real client connects,
  // since it'll be doing so against the (uncertified) IP instead — worth
  // surfacing rather than silently handing over a cert that looks right but
  // doesn't actually validate.
  async function handleUseWebdavPanelCert() {
    setWebdavPanelCertError(null)
    try {
      const ps = await api.getPanelSettings()
      if (!ps.TLSCertFile || !ps.TLSKeyFile) {
        setWebdavPanelCertError(t("xray.panelCertMissing"))
        return
      }
      setWd((s) => ({ ...s, tlsCertFile: ps.TLSCertFile, tlsKeyFile: ps.TLSKeyFile }))
      if (ps.ListenDomain) {
        const settings = await api.getSettings().catch(() => null)
        const resolvedHost = settings?.webdavPublicHost ?? ""
        if (resolvedHost && resolvedHost !== ps.ListenDomain) {
          setWebdavPanelCertError(
            `${t("profileForm.webdav.certDomainPrefix")} «${ps.ListenDomain}», ${t("profileForm.webdav.certHostSuffix")} «${resolvedHost}». ${t("profileForm.webdav.certHostMismatchNote")}`
          )
        }
      }
    } catch (err) {
      setWebdavPanelCertError(err instanceof Error ? err.message : t("xray.panelSettingsFetchFailed"))
    }
  }

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
  // and WebDAV are the opposite restriction: both are SOCKS5-native kernels
  // with no WireGuard-compatible transport of their own, so a wireguard
  // inbound is never a valid pick for either.
  const visibleInbounds =
    coreType === "freeturn"
      ? inbounds.filter((ib) => ib.Protocol === "hysteria2" || ib.Protocol === "wireguard")
      : coreType === "olcrtc" || coreType === "webdav"
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
        coreConfig: buildCoreConfig(coreType, tn, oc, ft, wd),
        enabled,
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
      setError(err instanceof Error ? err.message : t("profileForm.saveFailed"))
    } finally {
      setLoading(false)
    }
  }

  // xrayBlock sits above the "Route"/"-connect" box for Turnable/FreeTurn.
  const xrayBlock = (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="xray-enabled">{t("profileForm.xray.overlayLabel")}</Label>
        <Switch id="xray-enabled" checked={xrayEnabled} onCheckedChange={setXrayEnabled} />
      </div>
      {xrayEnabled && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="xray-inbound">{t("profileForm.xray.inboundLabel")}</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Select value={xrayInboundId} onValueChange={handlePickInbound}>
                  <SelectTrigger id="xray-inbound" className="w-full">
                    <SelectValue placeholder={t("profileForm.xray.inboundPlaceholder")} />
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
                  {t("profileForm.xray.reset")}
                </Button>
              )}
            </div>
            {coreType === "freeturn" && (
              <p className="text-xs text-muted-foreground">
                {t("profileForm.xray.freeturnNote")}
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
                    {t("profileForm.xray.wireguardConfig")}
                  </Button>
                </div>
              )}
              {(!supportsWireGuardManual || xrayManualMode === "uri") && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="xray-manual-uri">{t("profileForm.xray.manualUriLabel")}</Label>
                  <Input
                    id="xray-manual-uri"
                    value={xrayManualUri}
                    onChange={(e) => setXrayManualUri(e.target.value)}
                    placeholder={coreType === "freeturn" ? "hysteria2://..." : t("profileForm.xray.manualUriPlaceholder")}
                  />
                </div>
              )}
              {supportsWireGuardManual && xrayManualMode === "wireguard" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="xray-manual-wg">{t("profileForm.xray.wireguardConfig")}</Label>
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
                <Label htmlFor="xray-dual-route">{t("profileForm.xray.dualRouteLabel")}</Label>
                <Switch id="xray-dual-route" checked={xrayDualRoute} onCheckedChange={setXrayDualRoute} />
              </div>
              {xrayDualRoute && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="xray-direct-address">{t("profileForm.xray.directAddressLabel")}</Label>
                    <Input
                      id="xray-direct-address"
                      value={xrayDirectAddress}
                      onChange={(e) => setXrayDirectAddress(e.target.value)}
                      placeholder="1.2.3.4:443"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="xray-hc-interval">{t("profileForm.xray.hcIntervalLabel")}</Label>
                      <Input
                        id="xray-hc-interval"
                        type="number"
                        value={xrayHcInterval}
                        onChange={(e) => setXrayHcInterval(e.target.value)}
                        placeholder="30"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="xray-mux">{t("profileForm.xray.muxLabel")}</Label>
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
        <Label htmlFor="profile-name">{t("profileForm.name")}</Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="profile-enabled">{t("profileForm.enabledLabel")}</Label>
          <Switch id="profile-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <p className="text-xs text-muted-foreground">{t("profileForm.enabledHint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("profileForm.coreLabel")}</Label>
        <Select
          value={coreType}
          onValueChange={(v) => {
            const ct = v as CoreType
            setCoreType(ct)
            if (mode === "create") setXrayEnabled(defaultXrayEnabledForCore(ct))
          }}
          disabled={mode === "edit"}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CORE_LABELS) as (keyof typeof CORE_LABELS)[]).map((ct) => (
              <SelectItem key={ct} value={ct}>
                {t(CORE_LABELS[ct])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === "edit" && (
          <p className="text-xs text-muted-foreground">
            {t("profileForm.coreLockedNote")}
          </p>
        )}
      </div>

      {coreType === "turnable" && (
        <>
          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.turnable.connectionType")}</Label>
            <Select
              value={tn.connectionType}
              onValueChange={(v) => setTn({ ...tn, connectionType: v as TurnableState["connectionType"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relay">{t("profileForm.turnable.connectionTypeRelay")}</SelectItem>
                <SelectItem value="direct">{t("profileForm.turnable.connectionTypeDirect")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.turnable.protocol")}</Label>
            <Select value={tn.proto} onValueChange={(v) => setTn({ ...tn, proto: v as TurnableState["proto"] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="srtp">{t("profileForm.turnable.protoSrtp")}</SelectItem>
                <SelectItem value="dtls">DTLS</SelectItem>
                <SelectItem value="none">{t("profileForm.turnable.protoNone")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.turnable.platform")}</Label>
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
            <Label htmlFor="peers">{t("profileForm.turnable.peersLabel")}</Label>
            <Input
              id="peers"
              type="number"
              min={1}
              value={tn.peers}
              onChange={(e) => setTn({ ...tn, peers: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="tn-listen-port">{t("profileForm.listenPortLabel")}</Label>
            <Input
              id="tn-listen-port"
              type="number"
              value={tn.port}
              onChange={(e) => setTn({ ...tn, port: e.target.value })}
              placeholder={t("profileForm.listenPortPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="call-id">{t("profileForm.turnable.callIdLabel")}</Label>
            <Combobox
              id="call-id"
              options={vkRoomOptions}
              value={tn.callId}
              onChange={(v) => setTn({ ...tn, callId: v })}
              placeholder={t("profileForm.callIdComboPlaceholder")}
              required
              noMatchesText={t("common.noMatches")}
            />
            <VkCallHint />
          </div>

          {xrayBlock}

          <div className="rounded-md border p-3">
            <p className="mb-3 text-sm font-medium">{t("profileForm.turnable.routeTitle")}</p>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="route-host">{t("profileForm.hostLabel")}</Label>
                  <Input
                    id="route-host"
                    value={tn.routeHost}
                    onChange={(e) => setTn({ ...tn, routeHost: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="route-port">{t("profileForm.portLabel")}</Label>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("profileForm.turnable.socketType")}</Label>
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
                  <Label>{t("profileForm.turnable.routeTransportLabel")}</Label>
                  <Select
                    value={tn.routeTransport}
                    onValueChange={(v) => setTn({ ...tn, routeTransport: v as TurnableState["routeTransport"] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("profileForm.turnable.transportNoneUdp")}</SelectItem>
                      <SelectItem value="kcp">{t("profileForm.turnable.transportKcpTcp")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.turnable.encryptionLabel")}</Label>
            <Select
              value={tn.encryption}
              onValueChange={(v) => setTn({ ...tn, encryption: v as TurnableState["encryption"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="handshake">{t("profileForm.turnable.encryptionHandshake")}</SelectItem>
                <SelectItem value="full">{t("profileForm.turnable.encryptionFull")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <KeyField
            id="pub-key"
            label={t("profileForm.turnable.pubKeyLabel")}
            value={tn.pubKey}
            onChange={(v) => setTn({ ...tn, pubKey: v })}
            onGenerate={() =>
              api.keygenTurnable().then(({ pubKey, privKey }) =>
                setTn((s) => ({ ...s, pubKey, privKey }))
              )
            }
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="priv-key">{t("profileForm.turnable.privKeyLabel")}</Label>
            <Input
              id="priv-key"
              value={tn.privKey}
              onChange={(e) => setTn({ ...tn, privKey: e.target.value })}
              placeholder={t("profileForm.turnable.privKeyPlaceholder")}
              className="font-mono text-xs"
            />
          </div>
        </>
      )}

      {coreType === "olcrtc" && (
        <>
          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.olcrtc.provider")}</Label>
            <Select
              value={oc.provider}
              onValueChange={(v) => setOc({ ...oc, provider: v as OlcrtcState["provider"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jitsi">Jitsi</SelectItem>
                <SelectItem value="telemost">Telemost</SelectItem>
                <SelectItem value="wbstream">WB Stream</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-id">
              {oc.provider === "jitsi" ? t("profileForm.olcrtc.roomUrlLabel") : t("profileForm.olcrtc.roomIdLabel")}
            </Label>
            <Combobox
              id="room-id"
              options={olcrtcRoomOptions}
              value={oc.roomId}
              onChange={(v) => setOc({ ...oc, roomId: v })}
              placeholder={oc.provider === "jitsi" ? "https://meet.example.org/myroom" : ""}
              required
              noMatchesText={t("common.noMatches")}
            />
            <p className="text-xs text-muted-foreground">{t(OLCRTC_ROOM_ID_HINT_KEYS[oc.provider])}</p>
          </div>

          {oc.provider === "wbstream" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="olcrtc-auth-token">{t("profileForm.olcrtc.authTokenLabel")}</Label>
              <Input
                id="olcrtc-auth-token"
                value={oc.authToken}
                onChange={(e) => setOc({ ...oc, authToken: e.target.value })}
                placeholder={t("profileForm.olcrtc.authTokenPlaceholder")}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t("profileForm.olcrtc.authTokenHint")}</p>
            </div>
          )}

          <KeyField
            id="crypto-key"
            label={t("profileForm.olcrtc.cryptoKeyLabel")}
            value={oc.cryptoKey}
            onChange={(v) => setOc({ ...oc, cryptoKey: v })}
            onGenerate={() => api.keygenHex32().then(({ key }) => setOc((s) => ({ ...s, cryptoKey: key })))}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="dns">DNS</Label>
            <Input id="dns" value={oc.dns} onChange={(e) => setOc({ ...oc, dns: e.target.value })} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="olcrtc-proxy">{t("profileForm.olcrtc.proxyLabel")}</Label>
            <Input
              id="olcrtc-proxy"
              value={oc.proxyUpstream}
              onChange={(e) => setOc({ ...oc, proxyUpstream: e.target.value })}
              placeholder={t("profileForm.olcrtc.proxyPlaceholder")}
            />
          </div>

          <AdvancedFields>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                {/* min-h-10 (~2 lines of text-sm) reserves the same label
                    height across all three columns regardless of which
                    ones actually wrap — a plain flex-col here would let a
                    shorter one-line label (e.g. "Таймаут ответа") pull its
                    Input up above the two-line labels' Inputs beside it. */}
                <Label htmlFor="olcrtc-liveness-interval" className="min-h-10">
                  {t("profileForm.olcrtc.livenessIntervalLabel")}
                </Label>
                <Input
                  id="olcrtc-liveness-interval"
                  value={oc.livenessInterval}
                  onChange={(e) => setOc({ ...oc, livenessInterval: e.target.value })}
                  placeholder="10s"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="olcrtc-liveness-timeout" className="min-h-10">
                  {t("profileForm.olcrtc.livenessTimeoutLabel")}
                </Label>
                <Input
                  id="olcrtc-liveness-timeout"
                  value={oc.livenessTimeout}
                  onChange={(e) => setOc({ ...oc, livenessTimeout: e.target.value })}
                  placeholder="15s"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="olcrtc-liveness-failures" className="min-h-10">
                  {t("profileForm.olcrtc.livenessFailuresLabel")}
                </Label>
                <Input
                  id="olcrtc-liveness-failures"
                  type="number"
                  value={oc.livenessFailures}
                  onChange={(e) => setOc({ ...oc, livenessFailures: e.target.value })}
                  placeholder="4"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="olcrtc-max-session">{t("profileForm.olcrtc.maxSessionDurationLabel")}</Label>
              <Input
                id="olcrtc-max-session"
                value={oc.maxSessionDuration}
                onChange={(e) => setOc({ ...oc, maxSessionDuration: e.target.value })}
                placeholder={t("profileForm.olcrtc.maxSessionDurationPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("profileForm.olcrtc.maxSessionDurationHint")}</p>
            </div>
          </AdvancedFields>

          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.olcrtc.transportLabel")}</Label>
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
            <AdvancedFields label={t("profileForm.advancedTransportSettings")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="vp8-fps">VP8 stream FPS</Label>
                  <Input id="vp8-fps" type="number" value={oc.vp8Fps} onChange={(e) => setOc({ ...oc, vp8Fps: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="vp8-batch">Frames per tick</Label>
                  <Input id="vp8-batch" type="number" value={oc.vp8Batch} onChange={(e) => setOc({ ...oc, vp8Batch: e.target.value })} />
                </div>
              </div>
            </AdvancedFields>
          )}

          {oc.transport === "seichannel" && (
            <AdvancedFields label={t("profileForm.advancedTransportSettings")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-fps">H264 stream FPS</Label>
                  <Input id="sei-fps" type="number" value={oc.seiFps} onChange={(e) => setOc({ ...oc, seiFps: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-batch">Frames per tick</Label>
                  <Input id="sei-batch" type="number" value={oc.seiBatch} onChange={(e) => setOc({ ...oc, seiBatch: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-frag">Fragment size (bytes)</Label>
                  <Input id="sei-frag" type="number" value={oc.seiFrag} onChange={(e) => setOc({ ...oc, seiFrag: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sei-ack">ACK timeout (ms)</Label>
                  <Input id="sei-ack" type="number" value={oc.seiAck} onChange={(e) => setOc({ ...oc, seiAck: e.target.value })} />
                </div>
              </div>
            </AdvancedFields>
          )}

          {oc.transport === "videochannel" && (
            <AdvancedFields label={t("profileForm.advancedTransportSettings")}>
              <div className="flex flex-col gap-2">
                <Label>Codec</Label>
                <Select
                  value={oc.videoCodec}
                  onValueChange={(v) => setOc({ ...oc, videoCodec: v as OlcrtcState["videoCodec"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qrcode">qrcode</SelectItem>
                    <SelectItem value="tile">tile</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="video-width">Width (px)</Label>
                  <Input id="video-width" type="number" value={oc.videoWidth} onChange={(e) => setOc({ ...oc, videoWidth: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="video-height">Height (px)</Label>
                  <Input id="video-height" type="number" value={oc.videoHeight} onChange={(e) => setOc({ ...oc, videoHeight: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="video-fps">FPS</Label>
                  <Input id="video-fps" type="number" value={oc.videoFps} onChange={(e) => setOc({ ...oc, videoFps: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>QR error correction</Label>
                  <Select
                    value={oc.videoQrRecovery}
                    onValueChange={(v) => setOc({ ...oc, videoQrRecovery: v as OlcrtcState["videoQrRecovery"] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                      <SelectItem value="highest">highest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {oc.videoCodec === "tile" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="video-tile-module">Tile size (px)</Label>
                    <Input id="video-tile-module" type="number" value={oc.videoTileModule} onChange={(e) => setOc({ ...oc, videoTileModule: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="video-tile-rs">Reed-Solomon parity (%)</Label>
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
            <Label>{t("profileForm.freeturn.callIdsLabel")}</Label>
            <MultiSelect
              options={vkRoomOptions}
              value={ft.links}
              onChange={(v) => setFt({ ...ft, links: v })}
              placeholder={t("profileForm.callIdComboPlaceholder")}
              customValuePlaceholder={t("common.customValue")}
            />
            <VkCallHint />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.freeturn.transportLabel")}</Label>
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="ft-listen-port">{t("profileForm.listenPortLabel")}</Label>
            <Input
              id="ft-listen-port"
              type="number"
              value={ft.port}
              onChange={(e) => setFt({ ...ft, port: e.target.value })}
              placeholder={t("profileForm.listenPortPlaceholder")}
            />
          </div>

          {xrayBlock}

          <div className="rounded-md border p-3">
            <p className="mb-3 text-sm font-medium">{t("profileForm.freeturn.forwardTitle")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="connect-host">{t("profileForm.hostLabel")}</Label>
                <Input
                  id="connect-host"
                  value={ft.connectHost}
                  onChange={(e) => setFt({ ...ft, connectHost: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="connect-port">{t("profileForm.portLabel")}</Label>
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
            <Label>{t("profileForm.freeturn.obfProfileLabel")}</Label>
            <Select
              value={ft.obfProfile}
              onValueChange={(v) => setFt({ ...ft, obfProfile: v as FreeturnState["obfProfile"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rtpopus">{t("profileForm.freeturn.obfProfileRecommended")}</SelectItem>
                <SelectItem value="rtpopus2">rtpopus2</SelectItem>
                <SelectItem value="rtpopus3">rtpopus3</SelectItem>
                <SelectItem value="none">{t("profileForm.freeturn.obfProfileNone")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {ft.obfProfile !== "none" && (
            <KeyField
              id="obf-key"
              label={t("profileForm.freeturn.obfKeyLabel")}
              value={ft.obfKey}
              onChange={(v) => setFt({ ...ft, obfKey: v })}
              onGenerate={() => api.keygenHex32().then(({ key }) => setFt((s) => ({ ...s, obfKey: key })))}
            />
          )}

          {ft.obfProfile !== "none" && (
            <AdvancedFields>
              <div className="flex flex-col gap-2">
                <Label htmlFor="obf-timing">{t("profileForm.freeturn.obfTimingLabel")}</Label>
                <Input
                  id="obf-timing"
                  value={ft.obfTiming}
                  onChange={(e) => setFt({ ...ft, obfTiming: e.target.value })}
                  placeholder={t("profileForm.freeturn.obfTimingPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("profileForm.freeturn.obfTimingNote")}
                </p>
              </div>
            </AdvancedFields>
          )}
        </>
      )}

      {coreType === "webdav" && (
        <>
          <div className="flex flex-col gap-2">
            <Label>{t("profileForm.webdav.connModeLabel")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={wd.connMode === "selfhosted" ? "default" : "outline"}
                onClick={() => setWd({ ...wd, connMode: "selfhosted" })}
              >
                Self-hosted
              </Button>
              <Button
                type="button"
                size="sm"
                variant={wd.connMode === "server" ? "default" : "outline"}
                onClick={() => setWd({ ...wd, connMode: "server" })}
              >
                {t("profileForm.webdav.connModeServer")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {wd.connMode === "selfhosted"
                ? t("profileForm.webdav.connModeSelfhostedNote")
                : t("profileForm.webdav.connModeServerNote")}
            </p>
          </div>

          {wd.connMode === "selfhosted" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="webdav-login">{t("profileForm.webdav.loginLabel")}</Label>
                <Input
                  id="webdav-login"
                  value={wd.login}
                  onChange={(e) => setWd({ ...wd, login: e.target.value })}
                  placeholder={t("profileForm.webdav.autoGenPlaceholder")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="webdav-password">{t("profileForm.webdav.passwordLabel")}</Label>
                <Input
                  id="webdav-password"
                  value={wd.password}
                  onChange={(e) => setWd({ ...wd, password: e.target.value })}
                  placeholder={t("profileForm.webdav.autoGenPlaceholder")}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}

          {wd.connMode === "selfhosted" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="webdav-listen-port">{t("profileForm.listenPortLabel")}</Label>
              <Input
                id="webdav-listen-port"
                type="number"
                value={wd.port}
                onChange={(e) => setWd({ ...wd, port: e.target.value })}
                placeholder={t("profileForm.listenPortPlaceholder")}
              />
            </div>
          )}

          {wd.connMode === "server" && (
            <div className="rounded-md border p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">{t("profileForm.webdav.backendsTitle")}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setWd({ ...wd, backends: [...wd.backends, { url: "", login: "", password: "" }] })
                  }
                >
                  {t("profileForm.webdav.addBackend")}
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                {wd.backends.map((b, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-md border p-2">
                    <div className="flex items-center justify-between">
                      <Label>
                        {t("profileForm.webdav.backendLabel")} {i + 1}
                        {i === 0 && ` (${t("profileForm.webdav.backendPrimary")})`}
                      </Label>
                      {wd.backends.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setWd({ ...wd, backends: wd.backends.filter((_, j) => j !== i) })}
                        >
                          {t("common.delete")}
                        </Button>
                      )}
                    </div>
                    <Input
                      value={b.url}
                      onChange={(e) =>
                        setWd({
                          ...wd,
                          backends: wd.backends.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                        })
                      }
                      placeholder="https://dav.example.com"
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={b.login}
                        onChange={(e) =>
                          setWd({
                            ...wd,
                            backends: wd.backends.map((x, j) => (j === i ? { ...x, login: e.target.value } : x)),
                          })
                        }
                        placeholder={t("profileForm.webdav.loginPlaceholder")}
                      />
                      <Input
                        value={b.password}
                        onChange={(e) =>
                          setWd({
                            ...wd,
                            backends: wd.backends.map((x, j) => (j === i ? { ...x, password: e.target.value } : x)),
                          })
                        }
                        placeholder={t("profileForm.webdav.passwordPlaceholder")}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("profileForm.webdav.backendsNote")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="webdav-proxy">{t("profileForm.webdav.proxyLabel")}</Label>
              <Input
                id="webdav-proxy"
                value={wd.proxyUpstream}
                onChange={(e) => setWd({ ...wd, proxyUpstream: e.target.value })}
                placeholder={t("profileForm.webdav.proxyPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="webdav-dns">{t("profileForm.webdav.dnsLabel")}</Label>
              <Input
                id="webdav-dns"
                value={wd.dns}
                onChange={(e) => setWd({ ...wd, dns: e.target.value })}
                placeholder={t("profileForm.webdav.dnsPlaceholder")}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="webdav-enc">{t("profileForm.webdav.encLabel")}</Label>
            <Switch
              id="webdav-enc"
              checked={wd.enc}
              onCheckedChange={(v) => setWd({ ...wd, enc: v })}
            />
          </div>

          {wd.connMode === "selfhosted" && (
            <div className="rounded-md border p-3">
              <p className="mb-3 text-sm font-medium">{t("profileForm.webdav.tlsTitle")}</p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleUseWebdavPanelCert}>
                    {t("xray.usePanelCert")}
                  </Button>
                  {webdavPanelCertError && <p className="text-xs text-destructive">{webdavPanelCertError}</p>}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="webdav-tls-cert">{t("profileForm.webdav.tlsCertLabel")}</Label>
                  <Input
                    id="webdav-tls-cert"
                    value={wd.tlsCertFile}
                    onChange={(e) => setWd({ ...wd, tlsCertFile: e.target.value })}
                    placeholder={t("profileForm.webdav.tlsCertPlaceholder")}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="webdav-tls-key">{t("profileForm.webdav.tlsKeyLabel")}</Label>
                  <Input
                    id="webdav-tls-key"
                    value={wd.tlsKeyFile}
                    onChange={(e) => setWd({ ...wd, tlsKeyFile: e.target.value })}
                    placeholder={t("profileForm.webdav.tlsKeyPlaceholder")}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("profileForm.webdav.tlsNote")}
                </p>
              </div>
            </div>
          )}

          <AdvancedFields>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWd({ ...wd, tuning: WEBDAV_TUNING_PRESETS.selfhosted })}
              >
                {t("profileForm.webdav.presetSelfhosted")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWd({ ...wd, tuning: WEBDAV_TUNING_PRESETS.server })}
              >
                {t("profileForm.webdav.presetServer")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setWd({ ...wd, tuning: emptyWebdavTuning })}
              >
                {t("profileForm.webdav.presetReset")}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="webdav-poll-min">poll-min</Label>
                <Input
                  id="webdav-poll-min"
                  value={wd.tuning.pollMin}
                  onChange={(e) => setWd({ ...wd, tuning: { ...wd.tuning, pollMin: e.target.value } })}
                  placeholder={t("profileForm.webdav.autoPlaceholder")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="webdav-poll-max">poll-max</Label>
                <Input
                  id="webdav-poll-max"
                  value={wd.tuning.pollMax}
                  onChange={(e) => setWd({ ...wd, tuning: { ...wd.tuning, pollMax: e.target.value } })}
                  placeholder={t("profileForm.webdav.autoPlaceholder")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="webdav-coalesce">coalesce</Label>
                <Input
                  id="webdav-coalesce"
                  value={wd.tuning.coalesce}
                  onChange={(e) => setWd({ ...wd, tuning: { ...wd.tuning, coalesce: e.target.value } })}
                  placeholder={t("profileForm.webdav.autoPlaceholder")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="webdav-chunk-size">chunk-size</Label>
                <Input
                  id="webdav-chunk-size"
                  type="number"
                  value={wd.tuning.chunkSize}
                  onChange={(e) => setWd({ ...wd, tuning: { ...wd.tuning, chunkSize: e.target.value } })}
                  placeholder="131071"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="webdav-puts">puts</Label>
                <Input
                  id="webdav-puts"
                  type="number"
                  value={wd.tuning.puts}
                  onChange={(e) => setWd({ ...wd, tuning: { ...wd.tuning, puts: e.target.value } })}
                  placeholder="8"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="webdav-read-min">read-min</Label>
                  <Input
                    id="webdav-read-min"
                    type="number"
                    value={wd.tuning.readMin}
                    onChange={(e) => setWd({ ...wd, tuning: { ...wd.tuning, readMin: e.target.value } })}
                    placeholder="3"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="webdav-read-max">read-max</Label>
                  <Input
                    id="webdav-read-max"
                    type="number"
                    value={wd.tuning.readMax}
                    onChange={(e) => setWd({ ...wd, tuning: { ...wd.tuning, readMax: e.target.value } })}
                    placeholder="8"
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("profileForm.webdav.tuningNote")}
            </p>
          </AdvancedFields>
        </>
      )}

      {(coreType === "olcrtc" || coreType === "webdav") && xrayBlock}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={loading}>
          {loading ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
