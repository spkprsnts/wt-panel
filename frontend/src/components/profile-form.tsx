import * as React from "react"

import { useT } from "@/lib/i18n"
import type { TranslationKey } from "@/i18n"
import { api, type CallRoom, type CoreType, type RoomProvider, type XrayInbound } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { KeyField } from "@/components/ui/key-field"
import { Disclosure } from "@/components/ui/disclosure"
import { MultiSelect } from "@/components/ui/multi-select"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DialogFooter } from "@/components/ui/dialog"
import {
  SectionGroup,
  SectionItem,
  TextFieldRow,
  SwitchRow,
} from "@/components/ui/section"

const CORE_LABELS: Record<CoreType, TranslationKey> = {
  turnable: "profileForm.core.turnable",
  olcrtc: "profileForm.core.olcrtc",
  freeturn: "profileForm.core.freeturn",
  webdav: "profileForm.core.webdav",
}

// labelFor reads a Select's current value out of a value→label map — shared
// by every enum-valued Select field below (connection type, proto,
// encryption, route transport, obfProfile, ...) so the label shown in the
// trigger is always derived from the exact same map used to render the
// SelectItem list, instead of a separately hand-written ternary chain that
// could drift out of sync with it.
function labelFor<T extends string>(map: Record<T, string>, v: T | null): string | null {
  return v !== null && v in map ? map[v] : v
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
    let cancelled = false
    // Guards against a stale response landing after a newer one if the
    // operator switches provider again before the first fetch resolves —
    // without this, an out-of-order response can overwrite rooms with
    // suggestions from a provider that's no longer selected.
    api
      .listCallRooms(provider)
      .then((res) => {
        if (!cancelled) setRooms(res)
      })
      .catch(() => {
        if (!cancelled) setRooms([])
      })
    return () => {
      cancelled = true
    }
  }, [provider])
  return rooms
}

// VkCallHint is shared by Turnable's (single) and FreeTurn's (multiple)
// call-id fields — both ultimately need the same "where do I even get one
// of these" instructions, since both take a bare VK Calls id, not a link.
function VkCallHint() {
  const t = useT()
  return (
    <p className="text-xs text-on-surface-variant">
      {t("profileForm.vkHint.line1")} <code>vk.com/call/join/ABC123xyz...</code> —{" "}
      {t("profileForm.vkHint.line1b")} <code>/join/</code>.
      <br />
      {t("profileForm.vkHint.line2")} <code>"https://vk.com/call/join/"</code>
      {t("profileForm.vkHint.line2b")}
    </p>
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
  // Value→label maps for every enum-valued Select field below — see
  // labelFor's own doc comment for why these are shared between the
  // trigger's SelectValue and the SelectContent item list instead of each
  // maintaining its own copy of the same labels.
  const connectionTypeLabels: Record<TurnableState["connectionType"], string> = {
    relay: t("profileForm.turnable.connectionTypeRelay"),
    direct: t("profileForm.turnable.connectionTypeDirect"),
  }
  const protoLabels: Record<TurnableState["proto"], string> = {
    srtp: t("profileForm.turnable.protoSrtp"),
    dtls: "DTLS",
    none: t("profileForm.turnable.protoNone"),
  }
  const routeTransportLabels: Record<TurnableState["routeTransport"], string> = {
    none: t("profileForm.turnable.transportNoneUdp"),
    kcp: t("profileForm.turnable.transportKcpTcp"),
  }
  const encryptionLabels: Record<TurnableState["encryption"], string> = {
    handshake: t("profileForm.turnable.encryptionHandshake"),
    full: t("profileForm.turnable.encryptionFull"),
  }
  const obfProfileLabels: Record<FreeturnState["obfProfile"], string> = {
    rtpopus: t("profileForm.freeturn.obfProfileRecommended"),
    rtpopus2: "rtpopus2",
    rtpopus3: "rtpopus3",
    none: t("profileForm.freeturn.obfProfileNone"),
  }
  // Lets the footer's submit button (rendered outside this <form>, so it
  // can stay pinned below the scrolling fields — see the render below)
  // still submit it via the standard form="..." attribute.
  const formId = React.useId()
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
  function visibleInboundsFor(ct: CoreType, list: XrayInbound[]) {
    return ct === "freeturn"
      ? list.filter((ib) => ib.Protocol === "hysteria2" || ib.Protocol === "wireguard")
      : ct === "olcrtc" || ct === "webdav"
        ? list.filter((ib) => ib.Protocol !== "wireguard")
        : list
  }
  const visibleInbounds = visibleInboundsFor(coreType, inbounds)

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
  // Dual Route is its own separate SectionGroup (not nested inside a
  // SectionItem of the main one) — a SectionItem is a single joined-corner
  // row, not a container meant to host another whole grouped list inside
  // it; keeping them as sibling groups is what the corner-radius joining is
  // actually designed for.
  const xrayBlock = (
    <>
      <SectionGroup>
        <SectionItem
          position={xrayEnabled ? "top" : "single"}
          role="switch"
          aria-checked={xrayEnabled}
          onClick={() => setXrayEnabled(!xrayEnabled)}
        >
          <SwitchRow
            label={t("profileForm.xray.overlayLabel")}
            checked={xrayEnabled}
            onCheckedChange={setXrayEnabled}
          />
        </SectionItem>
        {xrayEnabled && (
          <>
            <SectionItem position={xrayInboundId ? "bottom" : "middle"}>
            <div className="flex w-full flex-col gap-2">
              <label htmlFor="xray-inbound" className="text-title-medium text-on-surface">{t("profileForm.xray.inboundLabel")}</label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Select value={xrayInboundId} onValueChange={(v) => handlePickInbound(v ?? "")}>
                    <SelectTrigger id="xray-inbound" className="w-full">
                      <SelectValue placeholder={t("profileForm.xray.inboundPlaceholder")}>
                        {(v: string | null) => {
                          const ib = visibleInbounds.find((ib) => String(ib.ID) === v)
                          return ib ? `${ib.Remark} — ${ib.Protocol} :${ib.Port}` : v
                        }}
                      </SelectValue>
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
                <p className="text-body-small text-on-surface-variant">
                  {t("profileForm.xray.freeturnNote")}
                </p>
              )}
            </div>
          </SectionItem>
          {!xrayInboundId && (
            <SectionItem position="bottom">
              <div className="flex w-full flex-col gap-2">
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
                  <TextFieldRow
                    id="xray-manual-uri"
                    label={t("profileForm.xray.manualUriLabel")}
                    value={xrayManualUri}
                    onChange={setXrayManualUri}
                    placeholder={coreType === "freeturn" ? "hysteria2://..." : t("profileForm.xray.manualUriPlaceholder")}
                  />
                )}
                {supportsWireGuardManual && xrayManualMode === "wireguard" && (
                  <TextFieldRow
                    id="xray-manual-wg"
                    label={t("profileForm.xray.wireguardConfig")}
                    value={xrayManualWireGuard}
                    onChange={setXrayManualWireGuard}
                    multiline
                    rows={6}
                    placeholder={"[Interface]\nPrivateKey = ...\nAddress = ...\n\n[Peer]\nPublicKey = ...\nEndpoint = ...\nAllowedIPs = ..."}
                  />
                )}
              </div>
            </SectionItem>
          )}
        </>
      )}
      </SectionGroup>
      {xrayEnabled && showDualRoute && (
        <SectionGroup>
          <SectionItem
            position={xrayDualRoute ? "top" : "single"}
            role="switch"
            aria-checked={xrayDualRoute}
            onClick={() => setXrayDualRoute(!xrayDualRoute)}
          >
            <SwitchRow
              label={t("profileForm.xray.dualRouteLabel")}
              checked={xrayDualRoute}
              onCheckedChange={setXrayDualRoute}
              supportingText={t("profileForm.xray.dualRouteHint")}
            />
          </SectionItem>
          {xrayDualRoute && (
            <>
              <SectionItem position="middle">
                <TextFieldRow
                  id="xray-direct-address"
                  label={t("profileForm.xray.directAddressLabel")}
                  value={xrayDirectAddress}
                  onChange={setXrayDirectAddress}
                  placeholder="1.2.3.4:443"
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="xray-hc-interval"
                  label={t("profileForm.xray.hcIntervalLabel")}
                  type="number"
                  value={xrayHcInterval}
                  onChange={setXrayHcInterval}
                  placeholder="30"
                />
              </SectionItem>
              <SectionItem position="bottom">
                <TextFieldRow
                  id="xray-mux"
                  label={t("profileForm.xray.muxLabel")}
                  type="number"
                  value={xrayMux}
                  onChange={setXrayMux}
                  placeholder="0"
                />
              </SectionItem>
            </>
          )}
        </SectionGroup>
      )}
    </>
  )

  return (
    <>
      {/* display:contents keeps this <form> out of the flex layout below —
          it exists purely so the footer's submit button (form={formId},
          rendered outside it) still triggers this form's onSubmit — while
          the actual scrolling happens on the div inside it, not on
          DialogContent itself. That's what keeps the dialog's header/close
          button and this footer pinned in place instead of scrolling away
          with the fields between them. */}
      <form id={formId} onSubmit={handleSubmit} className="contents">
        {/* px-6 lives here (not on DialogContent, see the dialog wrapper's
            own className) so the scrollbar this div grows renders flush at
            DialogContent's actual edge instead of inset within a shared
            padding — the content itself still gets the same inset via this
            div's own padding, just without dragging the scrollbar in with it. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
          <SectionGroup>
            <SectionItem position="top">
              <TextFieldRow
                label={t("profileForm.name")}
                value={name}
                onChange={setName}
                required
                autoFocus
              />
            </SectionItem>
            <SectionItem
              position="middle"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled(!enabled)}
            >
              <SwitchRow
                label={t("profileForm.enabledLabel")}
                checked={enabled}
                onCheckedChange={setEnabled}
                supportingText={t("profileForm.enabledHint")}
              />
            </SectionItem>
            <SectionItem position="bottom">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.coreLabel")}</label>
                <Select
                  value={coreType}
                  onValueChange={(v) => {
                    const ct = v as CoreType
                    setCoreType(ct)
                    if (mode === "create") setXrayEnabled(defaultXrayEnabledForCore(ct))
                    // The picked inbound may no longer be a valid target for the new
                    // core (e.g. a wireguard inbound is never valid for olcRTC/WebDAV) —
                    // clear it rather than silently keeping a filtered-out selection
                    // that would show as a bare ID and still get submitted.
                    if (xrayInboundId && !visibleInboundsFor(ct, inbounds).some((ib) => String(ib.ID) === xrayInboundId)) {
                      setXrayInboundId("")
                    }
                  }}
                  disabled={mode === "edit"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: CoreType | null) => (v ? t(CORE_LABELS[v]) : null)}</SelectValue>
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
                  <p className="text-body-small text-on-surface-variant">
                    {t("profileForm.coreLockedNote")}
                  </p>
                )}
              </div>
            </SectionItem>
          </SectionGroup>

      {coreType === "turnable" && (
        <>
          <SectionGroup>
            <SectionItem position="top">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.turnable.connectionType")}</label>
                <Select
                  value={tn.connectionType}
                  onValueChange={(v) => setTn({ ...tn, connectionType: v as TurnableState["connectionType"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: TurnableState["connectionType"] | null) => labelFor(connectionTypeLabels, v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(connectionTypeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="middle">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.turnable.protocol")}</label>
                <Select value={tn.proto} onValueChange={(v) => setTn({ ...tn, proto: v as TurnableState["proto"] })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: TurnableState["proto"] | null) => labelFor(protoLabels, v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(protoLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="middle">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.turnable.platform")}</label>
                <Select value={tn.platformId} onValueChange={(v) => setTn({ ...tn, platformId: v ?? "" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vk.com">vk.com</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                id="peers"
                label={t("profileForm.turnable.peersLabel")}
                type="number"
                min={1}
                value={tn.peers}
                onChange={(v) => setTn({ ...tn, peers: v })}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                id="tn-listen-port"
                label={t("profileForm.listenPortLabel")}
                type="number"
                value={tn.port}
                onChange={(v) => setTn({ ...tn, port: v })}
                placeholder={t("profileForm.listenPortPlaceholder")}
              />
            </SectionItem>
            <SectionItem position="bottom">
              <div className="flex w-full flex-col gap-1">
                <label htmlFor="call-id" className="text-title-medium text-on-surface">{t("profileForm.turnable.callIdLabel")}</label>
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
            </SectionItem>
          </SectionGroup>

          {xrayBlock}

          <SectionGroup title={t("profileForm.turnable.routeTitle")}>
            <SectionItem position="top">
              <TextFieldRow
                id="route-host"
                label={t("profileForm.hostLabel")}
                value={tn.routeHost}
                onChange={(v) => setTn({ ...tn, routeHost: v })}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                id="route-port"
                label={t("profileForm.portLabel")}
                type="number"
                value={tn.routePort}
                onChange={(v) => setTn({ ...tn, routePort: v })}
                required
                placeholder="51820"
              />
            </SectionItem>
            <SectionItem position="middle">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.turnable.socketType")}</label>
                <Select
                  value={tn.routeSocket}
                  onValueChange={(v) => {
                    const routeSocket = v as TurnableState["routeSocket"]
                    setTn({ ...tn, routeSocket, routeTransport: routeSocket === "udp" ? "none" : "kcp" })
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string | null) => v?.toUpperCase()}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="bottom">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.turnable.routeTransportLabel")}</label>
                <Select
                  value={tn.routeTransport}
                  onValueChange={(v) => setTn({ ...tn, routeTransport: v as TurnableState["routeTransport"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: TurnableState["routeTransport"] | null) => labelFor(routeTransportLabels, v)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(routeTransportLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
          </SectionGroup>

          <SectionGroup>
            <SectionItem position="top">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.turnable.encryptionLabel")}</label>
                <Select
                  value={tn.encryption}
                  onValueChange={(v) => setTn({ ...tn, encryption: v as TurnableState["encryption"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: TurnableState["encryption"] | null) => labelFor(encryptionLabels, v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(encryptionLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="middle">
              <KeyField
                id="pub-key"
                label={t("profileForm.turnable.pubKeyLabel")}
                value={tn.pubKey}
                onChange={(v) => setTn({ ...tn, pubKey: v })}
                placeholder={t("profileForm.keyField.placeholder")}
                generateLabel={t("profileForm.keyField.generate")}
                generateFailedLabel={t("profileForm.keyField.generateFailed")}
                onGenerate={() =>
                  api.keygenTurnable().then(({ pubKey, privKey }) =>
                    setTn((s) => ({ ...s, pubKey, privKey }))
                  )
                }
              />
            </SectionItem>
            <SectionItem position="bottom">
              <TextFieldRow
                id="priv-key"
                label={t("profileForm.turnable.privKeyLabel")}
                value={tn.privKey}
                onChange={(v) => setTn({ ...tn, privKey: v })}
                placeholder={t("profileForm.turnable.privKeyPlaceholder")}
              />
            </SectionItem>
          </SectionGroup>
        </>
      )}

      {coreType === "olcrtc" && (
        <>
          <SectionGroup>
            <SectionItem position="top">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.olcrtc.provider")}</label>
                <Select
                  value={oc.provider}
                  onValueChange={(v) => setOc({ ...oc, provider: v as OlcrtcState["provider"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) =>
                        ({ jitsi: "Jitsi", telemost: "Telemost", wbstream: "WB Stream" })[v ?? ""] ?? v
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jitsi">Jitsi</SelectItem>
                    <SelectItem value="telemost">Telemost</SelectItem>
                    <SelectItem value="wbstream">WB Stream</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="middle">
              <div className="flex w-full flex-col gap-1">
                <label htmlFor="room-id" className="text-title-medium text-on-surface">
                  {oc.provider === "jitsi" ? t("profileForm.olcrtc.roomUrlLabel") : t("profileForm.olcrtc.roomIdLabel")}
                </label>
                <Combobox
                  id="room-id"
                  options={olcrtcRoomOptions}
                  value={oc.roomId}
                  onChange={(v) => setOc({ ...oc, roomId: v })}
                  placeholder={oc.provider === "jitsi" ? "https://meet.example.org/myroom" : ""}
                  required
                  noMatchesText={t("common.noMatches")}
                />
                <p className="text-body-small text-on-surface-variant">{t(OLCRTC_ROOM_ID_HINT_KEYS[oc.provider])}</p>
              </div>
            </SectionItem>
            {oc.provider === "wbstream" && (
              <SectionItem position="middle">
                <TextFieldRow
                  id="olcrtc-auth-token"
                  label={t("profileForm.olcrtc.authTokenLabel")}
                  value={oc.authToken}
                  onChange={(v) => setOc({ ...oc, authToken: v })}
                  placeholder={t("profileForm.olcrtc.authTokenPlaceholder")}
                  supportingText={t("profileForm.olcrtc.authTokenHint")}
                />
              </SectionItem>
            )}
            <SectionItem position="middle">
              <KeyField
                id="crypto-key"
                label={t("profileForm.olcrtc.cryptoKeyLabel")}
                value={oc.cryptoKey}
                onChange={(v) => setOc({ ...oc, cryptoKey: v })}
                placeholder={t("profileForm.keyField.placeholder")}
                generateLabel={t("profileForm.keyField.generate")}
                generateFailedLabel={t("profileForm.keyField.generateFailed")}
                onGenerate={() => api.keygenHex32().then(({ key }) => setOc((s) => ({ ...s, cryptoKey: key })))}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow id="dns" label="DNS" value={oc.dns} onChange={(v) => setOc({ ...oc, dns: v })} />
            </SectionItem>
            <SectionItem position="bottom">
              <TextFieldRow
                id="olcrtc-proxy"
                label={t("profileForm.olcrtc.proxyLabel")}
                value={oc.proxyUpstream}
                onChange={(v) => setOc({ ...oc, proxyUpstream: v })}
                placeholder={t("profileForm.olcrtc.proxyPlaceholder")}
              />
            </SectionItem>
          </SectionGroup>

          <Disclosure title={t("profileForm.advancedSettings")}>
            <SectionGroup>
              <SectionItem position="top">
                <TextFieldRow
                  id="olcrtc-liveness-interval"
                  label={t("profileForm.olcrtc.livenessIntervalLabel")}
                  value={oc.livenessInterval}
                  onChange={(v) => setOc({ ...oc, livenessInterval: v })}
                  placeholder="10s"
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="olcrtc-liveness-timeout"
                  label={t("profileForm.olcrtc.livenessTimeoutLabel")}
                  value={oc.livenessTimeout}
                  onChange={(v) => setOc({ ...oc, livenessTimeout: v })}
                  placeholder="15s"
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="olcrtc-liveness-failures"
                  label={t("profileForm.olcrtc.livenessFailuresLabel")}
                  type="number"
                  value={oc.livenessFailures}
                  onChange={(v) => setOc({ ...oc, livenessFailures: v })}
                  placeholder="4"
                />
              </SectionItem>
              <SectionItem position="bottom">
                <TextFieldRow
                  id="olcrtc-max-session"
                  label={t("profileForm.olcrtc.maxSessionDurationLabel")}
                  value={oc.maxSessionDuration}
                  onChange={(v) => setOc({ ...oc, maxSessionDuration: v })}
                  placeholder={t("profileForm.olcrtc.maxSessionDurationPlaceholder")}
                  supportingText={t("profileForm.olcrtc.maxSessionDurationHint")}
                />
              </SectionItem>
            </SectionGroup>
          </Disclosure>

          <SectionGroup>
            <SectionItem position="single">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.olcrtc.transportLabel")}</label>
                <Select
                  value={oc.transport}
                  onValueChange={(v) => setOc({ ...oc, transport: v as OlcrtcState["transport"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) =>
                        ({
                          datachannel: "DataChannel",
                          vp8channel: "VP8Channel",
                          seichannel: "SEIChannel",
                          videochannel: "VideoChannel",
                        })[v ?? ""] ?? v
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="datachannel">DataChannel</SelectItem>
                    <SelectItem value="vp8channel">VP8Channel</SelectItem>
                    <SelectItem value="seichannel">SEIChannel</SelectItem>
                    <SelectItem value="videochannel">VideoChannel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
          </SectionGroup>

          {oc.transport === "vp8channel" && (
            <Disclosure title={t("profileForm.advancedTransportSettings")}>
              <SectionGroup>
                <SectionItem position="top">
                  <TextFieldRow
                    id="vp8-fps"
                    label="VP8 stream FPS"
                    type="number"
                    value={oc.vp8Fps}
                    onChange={(v) => setOc({ ...oc, vp8Fps: v })}
                  />
                </SectionItem>
                <SectionItem position="bottom">
                  <TextFieldRow
                    id="vp8-batch"
                    label="Frames per tick"
                    type="number"
                    value={oc.vp8Batch}
                    onChange={(v) => setOc({ ...oc, vp8Batch: v })}
                  />
                </SectionItem>
              </SectionGroup>
            </Disclosure>
          )}

          {oc.transport === "seichannel" && (
            <Disclosure title={t("profileForm.advancedTransportSettings")}>
              <SectionGroup>
                <SectionItem position="top">
                  <TextFieldRow
                    id="sei-fps"
                    label="H264 stream FPS"
                    type="number"
                    value={oc.seiFps}
                    onChange={(v) => setOc({ ...oc, seiFps: v })}
                  />
                </SectionItem>
                <SectionItem position="middle">
                  <TextFieldRow
                    id="sei-batch"
                    label="Frames per tick"
                    type="number"
                    value={oc.seiBatch}
                    onChange={(v) => setOc({ ...oc, seiBatch: v })}
                  />
                </SectionItem>
                <SectionItem position="middle">
                  <TextFieldRow
                    id="sei-frag"
                    label="Fragment size (bytes)"
                    type="number"
                    value={oc.seiFrag}
                    onChange={(v) => setOc({ ...oc, seiFrag: v })}
                  />
                </SectionItem>
                <SectionItem position="bottom">
                  <TextFieldRow
                    id="sei-ack"
                    label="ACK timeout (ms)"
                    type="number"
                    value={oc.seiAck}
                    onChange={(v) => setOc({ ...oc, seiAck: v })}
                  />
                </SectionItem>
              </SectionGroup>
            </Disclosure>
          )}

          {oc.transport === "videochannel" && (
            <Disclosure title={t("profileForm.advancedTransportSettings")}>
              <SectionGroup>
                <SectionItem position="top">
                  <div className="flex w-full flex-col gap-1">
                    <label className="text-title-medium text-on-surface">Codec</label>
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
                </SectionItem>
                <SectionItem position="middle">
                  <TextFieldRow
                    id="video-width"
                    label="Width (px)"
                    type="number"
                    value={oc.videoWidth}
                    onChange={(v) => setOc({ ...oc, videoWidth: v })}
                  />
                </SectionItem>
                <SectionItem position="middle">
                  <TextFieldRow
                    id="video-height"
                    label="Height (px)"
                    type="number"
                    value={oc.videoHeight}
                    onChange={(v) => setOc({ ...oc, videoHeight: v })}
                  />
                </SectionItem>
                <SectionItem position="middle">
                  <TextFieldRow
                    id="video-fps"
                    label="FPS"
                    type="number"
                    value={oc.videoFps}
                    onChange={(v) => setOc({ ...oc, videoFps: v })}
                  />
                </SectionItem>
                <SectionItem position={oc.videoCodec === "tile" ? "middle" : "bottom"}>
                  <div className="flex w-full flex-col gap-1">
                    <label className="text-title-medium text-on-surface">QR error correction</label>
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
                </SectionItem>
                {oc.videoCodec === "tile" && (
                  <>
                    <SectionItem position="middle">
                      <TextFieldRow
                        id="video-tile-module"
                        label="Tile size (px)"
                        type="number"
                        value={oc.videoTileModule}
                        onChange={(v) => setOc({ ...oc, videoTileModule: v })}
                      />
                    </SectionItem>
                    <SectionItem position="bottom">
                      <TextFieldRow
                        id="video-tile-rs"
                        label="Reed-Solomon parity (%)"
                        type="number"
                        value={oc.videoTileRs}
                        onChange={(v) => setOc({ ...oc, videoTileRs: v })}
                      />
                    </SectionItem>
                  </>
                )}
              </SectionGroup>
            </Disclosure>
          )}
        </>
      )}

      {coreType === "freeturn" && (
        <>
          <SectionGroup>
            <SectionItem position="top">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.freeturn.callIdsLabel")}</label>
                <MultiSelect
                  options={vkRoomOptions}
                  value={ft.links}
                  onChange={(v) => setFt({ ...ft, links: v })}
                  placeholder={t("profileForm.callIdComboPlaceholder")}
                  customValuePlaceholder={t("common.customValue")}
                  removeOptionLabel={(label) => `${t("common.remove")}: ${label}`}
                  addCustomValueLabel={t("common.add")}
                />
                <VkCallHint />
              </div>
            </SectionItem>
            <SectionItem position="middle">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.freeturn.transportLabel")}</label>
                <Select
                  value={ft.transport}
                  onValueChange={(v) => setFt({ ...ft, transport: v as FreeturnState["transport"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string | null) => v?.toUpperCase()}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="udp">UDP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="bottom">
              <TextFieldRow
                id="ft-listen-port"
                label={t("profileForm.listenPortLabel")}
                type="number"
                value={ft.port}
                onChange={(v) => setFt({ ...ft, port: v })}
                placeholder={t("profileForm.listenPortPlaceholder")}
              />
            </SectionItem>
          </SectionGroup>

          {xrayBlock}

          <SectionGroup title={t("profileForm.freeturn.forwardTitle")}>
            <SectionItem position="top">
              <TextFieldRow
                id="connect-host"
                label={t("profileForm.hostLabel")}
                value={ft.connectHost}
                onChange={(v) => setFt({ ...ft, connectHost: v })}
              />
            </SectionItem>
            <SectionItem position="bottom">
              <TextFieldRow
                id="connect-port"
                label={t("profileForm.portLabel")}
                type="number"
                value={ft.connectPort}
                onChange={(v) => setFt({ ...ft, connectPort: v })}
                required
                placeholder="51820"
              />
            </SectionItem>
          </SectionGroup>

          <SectionGroup>
            <SectionItem position={ft.obfProfile === "none" ? "single" : "top"}>
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("profileForm.freeturn.obfProfileLabel")}</label>
                <Select
                  value={ft.obfProfile}
                  onValueChange={(v) => setFt({ ...ft, obfProfile: v as FreeturnState["obfProfile"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: FreeturnState["obfProfile"] | null) => labelFor(obfProfileLabels, v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(obfProfileLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            {ft.obfProfile !== "none" && (
              <SectionItem position="bottom">
                <KeyField
                  id="obf-key"
                  label={t("profileForm.freeturn.obfKeyLabel")}
                  value={ft.obfKey}
                  onChange={(v) => setFt({ ...ft, obfKey: v })}
                  placeholder={t("profileForm.keyField.placeholder")}
                  generateLabel={t("profileForm.keyField.generate")}
                  generateFailedLabel={t("profileForm.keyField.generateFailed")}
                  onGenerate={() => api.keygenHex32().then(({ key }) => setFt((s) => ({ ...s, obfKey: key })))}
                />
              </SectionItem>
            )}
          </SectionGroup>

          {ft.obfProfile !== "none" && (
            <Disclosure title={t("profileForm.advancedSettings")}>
              <SectionGroup>
                <SectionItem position="single">
                  <TextFieldRow
                    id="obf-timing"
                    label={t("profileForm.freeturn.obfTimingLabel")}
                    value={ft.obfTiming}
                    onChange={(v) => setFt({ ...ft, obfTiming: v })}
                    placeholder={t("profileForm.freeturn.obfTimingPlaceholder")}
                    supportingText={t("profileForm.freeturn.obfTimingNote")}
                  />
                </SectionItem>
              </SectionGroup>
            </Disclosure>
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
            <p className="text-xs text-on-surface-variant">
              {wd.connMode === "selfhosted"
                ? t("profileForm.webdav.connModeSelfhostedNote")
                : t("profileForm.webdav.connModeServerNote")}
            </p>
          </div>

          {wd.connMode === "selfhosted" && (
            <SectionGroup>
              <SectionItem position="top">
                <TextFieldRow
                  id="webdav-login"
                  label={t("profileForm.webdav.loginLabel")}
                  value={wd.login}
                  onChange={(v) => setWd({ ...wd, login: v })}
                  placeholder={t("profileForm.webdav.autoGenPlaceholder")}
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="webdav-password"
                  label={t("profileForm.webdav.passwordLabel")}
                  value={wd.password}
                  onChange={(v) => setWd({ ...wd, password: v })}
                  placeholder={t("profileForm.webdav.autoGenPlaceholder")}
                />
              </SectionItem>
              <SectionItem position="bottom">
                <TextFieldRow
                  id="webdav-listen-port"
                  label={t("profileForm.listenPortLabel")}
                  type="number"
                  value={wd.port}
                  onChange={(v) => setWd({ ...wd, port: v })}
                  placeholder={t("profileForm.listenPortPlaceholder")}
                />
              </SectionItem>
            </SectionGroup>
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
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-on-surface-variant">
                {t("profileForm.webdav.backendsNote")}
              </p>
            </div>
          )}

          <SectionGroup>
            <SectionItem position="top">
              <TextFieldRow
                id="webdav-proxy"
                label={t("profileForm.webdav.proxyLabel")}
                value={wd.proxyUpstream}
                onChange={(v) => setWd({ ...wd, proxyUpstream: v })}
                placeholder={t("profileForm.webdav.proxyPlaceholder")}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                id="webdav-dns"
                label={t("profileForm.webdav.dnsLabel")}
                value={wd.dns}
                onChange={(v) => setWd({ ...wd, dns: v })}
                placeholder={t("profileForm.webdav.dnsPlaceholder")}
              />
            </SectionItem>
            <SectionItem
              position="bottom"
              role="switch"
              aria-checked={wd.enc}
              onClick={() => setWd({ ...wd, enc: !wd.enc })}
            >
              <SwitchRow
                label={t("profileForm.webdav.encLabel")}
                checked={wd.enc}
                onCheckedChange={(v) => setWd({ ...wd, enc: v })}
                supportingText={t("profileForm.webdav.encHint")}
              />
            </SectionItem>
          </SectionGroup>

          {wd.connMode === "selfhosted" && (
            <>
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleUseWebdavPanelCert}>
                  {t("xray.usePanelCert")}
                </Button>
                {webdavPanelCertError && <p className="text-xs text-error">{webdavPanelCertError}</p>}
              </div>
              <SectionGroup title={t("profileForm.webdav.tlsTitle")}>
                <SectionItem position="top">
                  <TextFieldRow
                    id="webdav-tls-cert"
                    label={t("profileForm.webdav.tlsCertLabel")}
                    value={wd.tlsCertFile}
                    onChange={(v) => setWd({ ...wd, tlsCertFile: v })}
                    placeholder={t("profileForm.webdav.tlsCertPlaceholder")}
                  />
                </SectionItem>
                <SectionItem position="bottom">
                  <TextFieldRow
                    id="webdav-tls-key"
                    label={t("profileForm.webdav.tlsKeyLabel")}
                    value={wd.tlsKeyFile}
                    onChange={(v) => setWd({ ...wd, tlsKeyFile: v })}
                    placeholder={t("profileForm.webdav.tlsKeyPlaceholder")}
                    supportingText={t("profileForm.webdav.tlsNote")}
                  />
                </SectionItem>
              </SectionGroup>
            </>
          )}

          <Disclosure title={t("profileForm.advancedSettings")}>
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
            <SectionGroup>
              <SectionItem position="top">
                <TextFieldRow
                  id="webdav-poll-min"
                  label="poll-min"
                  value={wd.tuning.pollMin}
                  onChange={(v) => setWd({ ...wd, tuning: { ...wd.tuning, pollMin: v } })}
                  placeholder={t("profileForm.webdav.autoPlaceholder")}
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="webdav-poll-max"
                  label="poll-max"
                  value={wd.tuning.pollMax}
                  onChange={(v) => setWd({ ...wd, tuning: { ...wd.tuning, pollMax: v } })}
                  placeholder={t("profileForm.webdav.autoPlaceholder")}
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="webdav-coalesce"
                  label="coalesce"
                  value={wd.tuning.coalesce}
                  onChange={(v) => setWd({ ...wd, tuning: { ...wd.tuning, coalesce: v } })}
                  placeholder={t("profileForm.webdav.autoPlaceholder")}
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="webdav-chunk-size"
                  label="chunk-size"
                  type="number"
                  value={wd.tuning.chunkSize}
                  onChange={(v) => setWd({ ...wd, tuning: { ...wd.tuning, chunkSize: v } })}
                  placeholder="131071"
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="webdav-puts"
                  label="puts"
                  type="number"
                  value={wd.tuning.puts}
                  onChange={(v) => setWd({ ...wd, tuning: { ...wd.tuning, puts: v } })}
                  placeholder="8"
                />
              </SectionItem>
              <SectionItem position="middle">
                <TextFieldRow
                  id="webdav-read-min"
                  label="read-min"
                  type="number"
                  value={wd.tuning.readMin}
                  onChange={(v) => setWd({ ...wd, tuning: { ...wd.tuning, readMin: v } })}
                  placeholder="3"
                />
              </SectionItem>
              <SectionItem position="bottom">
                <TextFieldRow
                  id="webdav-read-max"
                  label="read-max"
                  type="number"
                  value={wd.tuning.readMax}
                  onChange={(v) => setWd({ ...wd, tuning: { ...wd.tuning, readMax: v } })}
                  placeholder="8"
                  supportingText={t("profileForm.webdav.tuningNote")}
                />
              </SectionItem>
            </SectionGroup>
          </Disclosure>
        </>
      )}

          {(coreType === "olcrtc" || coreType === "webdav") && xrayBlock}
        </div>
      </form>
      {error && <p className="px-6 text-sm text-error">{error}</p>}
      <DialogFooter className="shrink-0 px-6">
        <Button type="submit" form={formId} disabled={loading}>
          {loading ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </>
  )
}
