import * as React from "react"
import { Link } from "react-router-dom"

import { api, type Client, type KernelStatus, type XrayClient, type XrayInbound, type XrayProtocol } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
import { useT } from "@/lib/i18n"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MultiSelect } from "@/components/ui/multi-select"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const PROTOCOL_LABELS: Record<XrayProtocol, string> = {
  vless: "VLESS",
  trojan: "Trojan",
  hysteria2: "Hysteria2",
  wireguard: "WireGuard",
}

const NETWORK_LABELS = {
  tcp: "TCP (raw)",
  ws: "WebSocket",
  grpc: "gRPC",
  kcp: "mKCP",
  httpupgrade: "HTTPUpgrade",
  xhttp: "XHTTP",
} as const
type Network = keyof typeof NETWORK_LABELS

const TLS_VERSIONS = ["1.0", "1.1", "1.2", "1.3"] as const
const ALPN_OPTIONS = [
  { value: "h3", label: "h3" },
  { value: "h2", label: "h2" },
  { value: "http/1.1", label: "http/1.1" },
]
const FINGERPRINTS = [
  "", "chrome", "firefox", "safari", "ios", "android", "edge",
  "360", "qq", "random", "randomized", "randomizednoalpn", "unsafe",
] as const
const XHTTP_MODES = ["auto", "packet-up", "stream-up", "stream-one"] as const

function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean)
}
function splitLines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean)
}

function SwitchField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

function AdvancedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-md border p-3 text-sm" open>
      <summary className="cursor-pointer font-medium text-on-surface-variant">{title}</summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  )
}

function KeyInput({
  id,
  label,
  value,
  onChange,
  onGenerate,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  onGenerate: () => Promise<unknown>
}) {
  const t = useT()
  const [generating, setGenerating] = React.useState(false)
  async function handleGenerate() {
    setGenerating(true)
    try {
      await onGenerate()
    } finally {
      setGenerating(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
        <Button type="button" variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? "..." : t("common.generate")}
        </Button>
      </div>
    </div>
  )
}

interface FallbackRow {
  name: string
  alpn: string
  path: string
  dest: string
  xver: string
}

interface InboundFormState {
  remark: string
  listen: string
  port: string
  enable: boolean

  network: Network
  security: "none" | "tls" | "reality"

  tcpHeaderType: "none" | "http"
  tcpAcceptProxyProtocol: boolean

  wsPath: string
  wsHost: string
  wsHeartbeatPeriod: string
  wsAcceptProxyProtocol: boolean

  grpcServiceName: string
  grpcAuthority: string
  grpcMultiMode: boolean

  kcpMtu: string
  kcpTti: string
  kcpUplinkCapacity: string
  kcpDownlinkCapacity: string
  kcpCwndMultiplier: string
  kcpMaxSendingWindow: string

  httpupgradePath: string
  httpupgradeHost: string
  httpupgradeAcceptProxyProtocol: boolean

  xhttpPath: string
  xhttpHost: string
  xhttpMode: (typeof XHTTP_MODES)[number]
  xhttpEnableXmux: boolean
  xhttpMaxConcurrency: string
  xhttpMaxConnections: string

  tlsServerName: string
  tlsMinVersion: (typeof TLS_VERSIONS)[number]
  tlsMaxVersion: (typeof TLS_VERSIONS)[number]
  tlsAlpn: string[]
  tlsFingerprint: string
  tlsRejectUnknownSni: boolean
  tlsDisableSystemRoot: boolean
  tlsEnableSessionResumption: boolean
  tlsCertMode: "file" | "inline"
  tlsCertFile: string
  tlsKeyFile: string
  tlsCertInline: string
  tlsKeyInline: string

  realityTarget: string
  realityServerNames: string
  realityPrivateKey: string
  realityPublicKey: string
  realityShortIds: string
  realityFingerprint: string
  realitySpiderX: string
  realityMinClientVer: string
  realityMaxClientVer: string
  realityMaxTimediff: string

  fallbacks: FallbackRow[]

  wgSecretKey: string
  wgPublicKey: string
  wgAddress: string
  wgMtu: string

  sniffingEnabled: boolean
  sniffingDestOverride: string
}

// randomPort suggests a starting point for a brand-new inbound's listen
// port — picked from the high, rarely-reserved range so it's unlikely to
// collide with anything else already running on the box; the operator can
// always type over it before saving.
function randomPort(): number {
  return 10000 + Math.floor(Math.random() * 55536)
}

function emptyForm(defaultRemark = ""): InboundFormState {
  return {
    remark: defaultRemark,
    listen: "",
    port: String(randomPort()),
    enable: true,
    network: "tcp",
    security: "none",
    tcpHeaderType: "none",
    tcpAcceptProxyProtocol: false,
    wsPath: "/",
    wsHost: "",
    wsHeartbeatPeriod: "0",
    wsAcceptProxyProtocol: false,
    grpcServiceName: "",
    grpcAuthority: "",
    grpcMultiMode: false,
    kcpMtu: "1350",
    kcpTti: "20",
    kcpUplinkCapacity: "5",
    kcpDownlinkCapacity: "20",
    kcpCwndMultiplier: "1",
    kcpMaxSendingWindow: "2097152",
    httpupgradePath: "/",
    httpupgradeHost: "",
    httpupgradeAcceptProxyProtocol: false,
    xhttpPath: "/",
    xhttpHost: "",
    xhttpMode: "auto",
    xhttpEnableXmux: false,
    xhttpMaxConcurrency: "16-32",
    xhttpMaxConnections: "0",
    tlsServerName: "",
    tlsMinVersion: "1.2",
    tlsMaxVersion: "1.3",
    tlsAlpn: ["h3"],
    tlsFingerprint: "chrome",
    tlsRejectUnknownSni: false,
    tlsDisableSystemRoot: false,
    tlsEnableSessionResumption: false,
    tlsCertMode: "file",
    tlsCertFile: "",
    tlsKeyFile: "",
    tlsCertInline: "",
    tlsKeyInline: "",
    realityTarget: "www.microsoft.com:443",
    realityServerNames: "www.microsoft.com",
    realityPrivateKey: "",
    realityPublicKey: "",
    realityShortIds: "",
    realityFingerprint: "chrome",
    realitySpiderX: "/",
    realityMinClientVer: "",
    realityMaxClientVer: "",
    realityMaxTimediff: "0",
    fallbacks: [],
    wgSecretKey: "",
    wgPublicKey: "",
    wgAddress: "10.0.0.1/24",
    wgMtu: "1280",
    sniffingEnabled: true,
    sniffingDestOverride: "http,tls",
  }
}

// formFromInbound reconstructs form state from an existing inbound's stored
// JSON — used when opening the edit dialog. Falls back to defaults for any
// field that isn't present (e.g. an inbound created before a field existed).
function formFromInbound(inbound: XrayInbound): InboundFormState {
  const base = emptyForm()
  let settings: Record<string, unknown> = {}
  let stream: Record<string, unknown> = {}
  let sniffing: Record<string, unknown> = {}
  try {
    settings = inbound.Settings ? JSON.parse(inbound.Settings) : {}
  } catch {
    /* leave defaults */
  }
  try {
    stream = inbound.StreamSettings ? JSON.parse(inbound.StreamSettings) : {}
  } catch {
    /* leave defaults */
  }
  try {
    sniffing = inbound.Sniffing ? JSON.parse(inbound.Sniffing) : {}
  } catch {
    /* leave defaults */
  }

  const tcpSettings = (stream.tcpSettings as Record<string, unknown>) ?? {}
  const wsSettings = (stream.wsSettings as Record<string, unknown>) ?? {}
  const grpcSettings = (stream.grpcSettings as Record<string, unknown>) ?? {}
  const kcpSettings = (stream.kcpSettings as Record<string, unknown>) ?? {}
  const httpupgradeSettings = (stream.httpupgradeSettings as Record<string, unknown>) ?? {}
  const xhttpSettings = (stream.xhttpSettings as Record<string, unknown>) ?? {}
  const xhttpXmux = (xhttpSettings.xmux as Record<string, unknown>) ?? {}
  const tlsSettings = (stream.tlsSettings as Record<string, unknown>) ?? {}
  const tlsClientSettings = (tlsSettings.settings as Record<string, unknown>) ?? {}
  const cert = (Array.isArray(tlsSettings.certificates) ? tlsSettings.certificates[0] : undefined) as
    | Record<string, unknown>
    | undefined
  const realitySettings = (stream.realitySettings as Record<string, unknown>) ?? {}
  const realityClientSettings = (realitySettings.settings as Record<string, unknown>) ?? {}
  const header = (tcpSettings.header as Record<string, unknown>) ?? {}
  const fallbacksRaw = Array.isArray(settings.fallbacks) ? (settings.fallbacks as Record<string, unknown>[]) : []

  return {
    ...base,
    remark: inbound.Remark,
    listen: inbound.Listen,
    port: String(inbound.Port),
    enable: inbound.Enable,
    network: (stream.network as Network) ?? base.network,
    security: (stream.security as InboundFormState["security"]) ?? base.security,

    tcpHeaderType: (header.type as InboundFormState["tcpHeaderType"]) ?? base.tcpHeaderType,
    tcpAcceptProxyProtocol: (tcpSettings.acceptProxyProtocol as boolean) ?? base.tcpAcceptProxyProtocol,

    wsPath: (wsSettings.path as string) ?? base.wsPath,
    wsHost: (wsSettings.host as string) ?? base.wsHost,
    wsHeartbeatPeriod: wsSettings.heartbeatPeriod !== undefined ? String(wsSettings.heartbeatPeriod) : base.wsHeartbeatPeriod,
    wsAcceptProxyProtocol: (wsSettings.acceptProxyProtocol as boolean) ?? base.wsAcceptProxyProtocol,

    grpcServiceName: (grpcSettings.serviceName as string) ?? base.grpcServiceName,
    grpcAuthority: (grpcSettings.authority as string) ?? base.grpcAuthority,
    grpcMultiMode: (grpcSettings.multiMode as boolean) ?? base.grpcMultiMode,

    kcpMtu: kcpSettings.mtu !== undefined ? String(kcpSettings.mtu) : base.kcpMtu,
    kcpTti: kcpSettings.tti !== undefined ? String(kcpSettings.tti) : base.kcpTti,
    kcpUplinkCapacity: kcpSettings.uplinkCapacity !== undefined ? String(kcpSettings.uplinkCapacity) : base.kcpUplinkCapacity,
    kcpDownlinkCapacity: kcpSettings.downlinkCapacity !== undefined ? String(kcpSettings.downlinkCapacity) : base.kcpDownlinkCapacity,
    kcpCwndMultiplier: kcpSettings.cwndMultiplier !== undefined ? String(kcpSettings.cwndMultiplier) : base.kcpCwndMultiplier,
    kcpMaxSendingWindow: kcpSettings.maxSendingWindow !== undefined ? String(kcpSettings.maxSendingWindow) : base.kcpMaxSendingWindow,

    httpupgradePath: (httpupgradeSettings.path as string) ?? base.httpupgradePath,
    httpupgradeHost: (httpupgradeSettings.host as string) ?? base.httpupgradeHost,
    httpupgradeAcceptProxyProtocol: (httpupgradeSettings.acceptProxyProtocol as boolean) ?? base.httpupgradeAcceptProxyProtocol,

    xhttpPath: (xhttpSettings.path as string) ?? base.xhttpPath,
    xhttpHost: (xhttpSettings.host as string) ?? base.xhttpHost,
    xhttpMode: (xhttpSettings.mode as InboundFormState["xhttpMode"]) ?? base.xhttpMode,
    xhttpEnableXmux: !!xhttpSettings.xmux,
    xhttpMaxConcurrency: (xhttpXmux.maxConcurrency as string) ?? base.xhttpMaxConcurrency,
    xhttpMaxConnections: xhttpXmux.maxConnections !== undefined ? String(xhttpXmux.maxConnections) : base.xhttpMaxConnections,

    tlsServerName: (tlsSettings.serverName as string) ?? base.tlsServerName,
    tlsMinVersion: (tlsSettings.minVersion as InboundFormState["tlsMinVersion"]) ?? base.tlsMinVersion,
    tlsMaxVersion: (tlsSettings.maxVersion as InboundFormState["tlsMaxVersion"]) ?? base.tlsMaxVersion,
    tlsAlpn: Array.isArray(tlsSettings.alpn) ? (tlsSettings.alpn as string[]) : base.tlsAlpn,
    tlsFingerprint: (tlsClientSettings.fingerprint as string) ?? base.tlsFingerprint,
    tlsRejectUnknownSni: (tlsSettings.rejectUnknownSni as boolean) ?? base.tlsRejectUnknownSni,
    tlsDisableSystemRoot: (tlsSettings.disableSystemRoot as boolean) ?? base.tlsDisableSystemRoot,
    tlsEnableSessionResumption: (tlsSettings.enableSessionResumption as boolean) ?? base.tlsEnableSessionResumption,
    tlsCertMode: cert && cert.useFile === false ? "inline" : base.tlsCertMode,
    tlsCertFile: (cert?.certificateFile as string) ?? base.tlsCertFile,
    tlsKeyFile: (cert?.keyFile as string) ?? base.tlsKeyFile,
    tlsCertInline: Array.isArray(cert?.certificate) ? (cert!.certificate as string[]).join("\n") : base.tlsCertInline,
    tlsKeyInline: Array.isArray(cert?.key) ? (cert!.key as string[]).join("\n") : base.tlsKeyInline,

    realityTarget: (realitySettings.target as string) ?? base.realityTarget,
    realityServerNames: Array.isArray(realitySettings.serverNames)
      ? (realitySettings.serverNames as string[]).join(",")
      : base.realityServerNames,
    realityPrivateKey: (realitySettings.privateKey as string) ?? base.realityPrivateKey,
    realityPublicKey: (realityClientSettings.publicKey as string) ?? base.realityPublicKey,
    realityShortIds: Array.isArray(realitySettings.shortIds)
      ? (realitySettings.shortIds as string[]).join(",")
      : base.realityShortIds,
    realityFingerprint: (realityClientSettings.fingerprint as string) ?? base.realityFingerprint,
    realitySpiderX: (realityClientSettings.spiderX as string) ?? base.realitySpiderX,
    realityMinClientVer: (realitySettings.minClientVer as string) ?? base.realityMinClientVer,
    realityMaxClientVer: (realitySettings.maxClientVer as string) ?? base.realityMaxClientVer,
    realityMaxTimediff: realitySettings.maxTimediff !== undefined ? String(realitySettings.maxTimediff) : base.realityMaxTimediff,

    fallbacks: fallbacksRaw.map((fb) => ({
      name: (fb.name as string) ?? "",
      alpn: (fb.alpn as string) ?? "",
      path: (fb.path as string) ?? "",
      dest: String(fb.dest ?? ""),
      xver: fb.xver !== undefined ? String(fb.xver) : "0",
    })),

    wgSecretKey: (settings.secretKey as string) ?? base.wgSecretKey,
    wgPublicKey: (settings.publicKey as string) ?? base.wgPublicKey,
    wgAddress: Array.isArray(settings.address)
      ? (settings.address as string[]).join(",")
      : base.wgAddress,
    wgMtu: settings.mtu !== undefined ? String(settings.mtu) : base.wgMtu,
    sniffingEnabled: (sniffing.enabled as boolean) ?? base.sniffingEnabled,
    sniffingDestOverride: Array.isArray(sniffing.destOverride)
      ? (sniffing.destOverride as string[]).join(",")
      : base.sniffingDestOverride,
  }
}

function buildTlsSettings(f: InboundFormState) {
  const cert =
    f.tlsCertMode === "file"
      ? {
          useFile: true,
          certificateFile: f.tlsCertFile,
          keyFile: f.tlsKeyFile,
          certificate: [],
          key: [],
          ocspStapling: 0,
          oneTimeLoading: false,
          usage: "encipherment",
          buildChain: false,
        }
      : {
          useFile: false,
          certificateFile: "",
          keyFile: "",
          certificate: splitLines(f.tlsCertInline),
          key: splitLines(f.tlsKeyInline),
          ocspStapling: 0,
          oneTimeLoading: false,
          usage: "encipherment",
          buildChain: false,
        }
  return {
    serverName: f.tlsServerName,
    minVersion: f.tlsMinVersion,
    maxVersion: f.tlsMaxVersion,
    alpn: f.tlsAlpn,
    rejectUnknownSni: f.tlsRejectUnknownSni,
    disableSystemRoot: f.tlsDisableSystemRoot,
    enableSessionResumption: f.tlsEnableSessionResumption,
    certificates: [cert],
    settings: { fingerprint: f.tlsFingerprint, echConfigList: "" },
  }
}

function buildRealitySettings(f: InboundFormState) {
  return {
    target: f.realityTarget,
    serverNames: splitList(f.realityServerNames),
    privateKey: f.realityPrivateKey,
    shortIds: splitList(f.realityShortIds),
    minClientVer: f.realityMinClientVer,
    maxClientVer: f.realityMaxClientVer,
    maxTimediff: Number(f.realityMaxTimediff) || 0,
    settings: {
      publicKey: f.realityPublicKey,
      fingerprint: f.realityFingerprint,
      spiderX: f.realitySpiderX || "/",
    },
  }
}

function buildNetworkSettings(f: InboundFormState): Record<string, unknown> {
  switch (f.network) {
    case "tcp":
      return { tcpSettings: { acceptProxyProtocol: f.tcpAcceptProxyProtocol, header: { type: f.tcpHeaderType } } }
    case "ws":
      return {
        wsSettings: {
          acceptProxyProtocol: f.wsAcceptProxyProtocol,
          path: f.wsPath,
          host: f.wsHost,
          headers: {},
          heartbeatPeriod: Number(f.wsHeartbeatPeriod) || 0,
        },
      }
    case "grpc":
      return { grpcSettings: { serviceName: f.grpcServiceName, authority: f.grpcAuthority, multiMode: f.grpcMultiMode } }
    case "kcp":
      return {
        kcpSettings: {
          mtu: Number(f.kcpMtu) || 1350,
          tti: Number(f.kcpTti) || 20,
          uplinkCapacity: Number(f.kcpUplinkCapacity) || 5,
          downlinkCapacity: Number(f.kcpDownlinkCapacity) || 20,
          cwndMultiplier: Number(f.kcpCwndMultiplier) || 1,
          maxSendingWindow: Number(f.kcpMaxSendingWindow) || 2097152,
        },
      }
    case "httpupgrade":
      return {
        httpupgradeSettings: {
          acceptProxyProtocol: f.httpupgradeAcceptProxyProtocol,
          path: f.httpupgradePath,
          host: f.httpupgradeHost,
          headers: {},
        },
      }
    case "xhttp":
      return {
        xhttpSettings: {
          path: f.xhttpPath,
          host: f.xhttpHost,
          mode: f.xhttpMode,
          ...(f.xhttpEnableXmux && {
            xmux: {
              maxConcurrency: f.xhttpMaxConcurrency,
              maxConnections: Number(f.xhttpMaxConnections) || 0,
              cMaxReuseTimes: 0,
              hMaxRequestTimes: "600-900",
              hMaxReusableSecs: "1800-3000",
              hKeepAlivePeriod: 0,
            },
          }),
        },
      }
  }
}

function buildPayload(protocol: XrayProtocol, f: InboundFormState) {
  let settings: Record<string, unknown> = {}
  let streamSettings: Record<string, unknown> | undefined

  if (protocol === "vless" || protocol === "trojan") {
    const fallbacks = f.fallbacks.map((fb) => ({
      name: fb.name,
      alpn: fb.alpn,
      path: fb.path,
      dest: fb.dest,
      xver: Number(fb.xver) || 0,
    }))
    settings = protocol === "vless" ? { decryption: "none", fallbacks } : { fallbacks }
    streamSettings = {
      network: f.network,
      security: f.security,
      ...buildNetworkSettings(f),
      ...(f.security === "tls" && { tlsSettings: buildTlsSettings(f) }),
      ...(f.security === "reality" && { realitySettings: buildRealitySettings(f) }),
    }
  } else if (protocol === "hysteria2") {
    // Hysteria2 is QUIC — TLS isn't optional the way it is for vless/trojan,
    // so there's no "security" choice or transport choice here, just the
    // same TLS fields always applied. Matches upstream: no obfs/bandwidth
    // knobs in the current inbound schema (both were dropped upstream).
    //
    // network/hysteriaSettings (not "tcp"/tcpSettings) is load-bearing, not
    // cosmetic: xray-core's own hysteria proxy (proxy/hysteria/server.go)
    // asserts streamSettings.ProtocolSettings is its internal *hysteria.Config
    // and refuses to start ("not hysteria transport") otherwise — confirmed
    // against the real upstream source, same place the "hysteria2" vs
    // "hysteria" protocol-id mismatch was confirmed (see xrayCoreProtocol
    // on the backend). hysteriaSettings.version must also be 2 —
    // infra/conf's own HysteriaConfig.Build() rejects anything else, same
    // check the proxy-level settings.version above already satisfies.
    settings = { version: 2 }
    streamSettings = {
      network: "hysteria",
      hysteriaSettings: { version: 2 },
      security: "tls",
      tlsSettings: buildTlsSettings(f),
    }
  } else if (protocol === "wireguard") {
    settings = {
      secretKey: f.wgSecretKey,
      publicKey: f.wgPublicKey,
      address: splitList(f.wgAddress),
      mtu: Number(f.wgMtu) || 1280,
    }
  }

  return {
    protocol,
    remark: f.remark,
    listen: f.listen,
    port: Number(f.port) || 0,
    enable: f.enable,
    settings,
    ...(streamSettings && { streamSettings }),
    sniffing: { enabled: f.sniffingEnabled, destOverride: splitList(f.sniffingDestOverride) },
  }
}

function TlsFields({
  f,
  setF,
  alpnDefault,
}: {
  f: InboundFormState
  setF: React.Dispatch<React.SetStateAction<InboundFormState>>
  alpnDefault: string[]
}) {
  const t = useT()
  const [panelCertError, setPanelCertError] = React.useState<string | null>(null)

  // Hysteria2 requires TLS outright (no plaintext fallback the way
  // vless/trojan have) — reusing whatever cert the panel's own HTTPS
  // listener already has (Settings → "Panel network", normally a real
  // Let's Encrypt cert from install.sh's SSL setup) means the operator
  // doesn't need to issue or paste in a second cert just for this inbound.
  // Only meaningfully different from typing the paths in by hand when the
  // panel actually has TLS configured — surfaced as an error rather than
  // silently doing nothing if it doesn't.
  async function handleUsePanelCert() {
    setPanelCertError(null)
    try {
      const ps = await api.getPanelSettings()
      if (!ps.TLSCertFile || !ps.TLSKeyFile) {
        setPanelCertError(t("xray.panelCertMissing"))
        return
      }
      setF({
        ...f,
        tlsCertMode: "file",
        tlsCertFile: ps.TLSCertFile,
        tlsKeyFile: ps.TLSKeyFile,
        tlsServerName: ps.ListenDomain || f.tlsServerName,
      })
    } catch (err) {
      setPanelCertError(err instanceof Error ? err.message : t("xray.panelSettingsFetchFailed"))
    }
  }

  return (
    <AdvancedSection title={t("xray.tlsSettingsTitle")}>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleUsePanelCert}>
          {t("xray.usePanelCert")}
        </Button>
        {panelCertError && <p className="text-xs text-error">{panelCertError}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="tls-sni">Server name (SNI)</Label>
        <Input id="tls-sni" value={f.tlsServerName} onChange={(e) => setF({ ...f, tlsServerName: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Min version</Label>
          <Select value={f.tlsMinVersion} onValueChange={(v) => setF({ ...f, tlsMinVersion: v as InboundFormState["tlsMinVersion"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TLS_VERSIONS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Max version</Label>
          <Select value={f.tlsMaxVersion} onValueChange={(v) => setF({ ...f, tlsMaxVersion: v as InboundFormState["tlsMaxVersion"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TLS_VERSIONS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label>ALPN</Label>
        <MultiSelect
          options={ALPN_OPTIONS}
          value={f.tlsAlpn}
          onChange={(v) => setF({ ...f, tlsAlpn: v })}
          placeholder={`${t("xray.alpnDefaultPrefix")}: ${alpnDefault.join(", ")}`}
          customValuePlaceholder={t("common.customValue")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>uTLS fingerprint</Label>
        <Select value={f.tlsFingerprint} onValueChange={(v) => setF({ ...f, tlsFingerprint: v ?? "" })}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string | null) => v || "None"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FINGERPRINTS.map((fp) => (
              <SelectItem key={fp || "none"} value={fp}>
                {fp || "None"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("xray.certificateLabel")}</Label>
        <Select value={f.tlsCertMode} onValueChange={(v) => setF({ ...f, tlsCertMode: v as InboundFormState["tlsCertMode"] })}>
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string | null) => (v === "file" ? t("xray.certModeFile") : v === "inline" ? t("xray.certModeInline") : v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="file">{t("xray.certModeFile")}</SelectItem>
            <SelectItem value="inline">{t("xray.certModeInline")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {f.tlsCertMode === "file" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tls-cert-file">{t("xray.certFileLabel")}</Label>
            <Input id="tls-cert-file" value={f.tlsCertFile} onChange={(e) => setF({ ...f, tlsCertFile: e.target.value })} placeholder="/etc/ssl/certs/example.crt" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tls-key-file">{t("xray.keyFileLabel")}</Label>
            <Input id="tls-key-file" value={f.tlsKeyFile} onChange={(e) => setF({ ...f, tlsKeyFile: e.target.value })} placeholder="/etc/ssl/private/example.key" />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tls-cert-inline">{t("xray.certInlineLabel")}</Label>
            <Textarea id="tls-cert-inline" value={f.tlsCertInline} onChange={(e) => setF({ ...f, tlsCertInline: e.target.value })} className="font-mono text-xs" rows={4} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tls-key-inline">{t("xray.keyInlineLabel")}</Label>
            <Textarea id="tls-key-inline" value={f.tlsKeyInline} onChange={(e) => setF({ ...f, tlsKeyInline: e.target.value })} className="font-mono text-xs" rows={4} />
          </div>
        </>
      )}

      <SwitchField id="tls-reject-unknown-sni" label="rejectUnknownSni" checked={f.tlsRejectUnknownSni} onChange={(v) => setF({ ...f, tlsRejectUnknownSni: v })} />
      <SwitchField id="tls-disable-system-root" label="disableSystemRoot" checked={f.tlsDisableSystemRoot} onChange={(v) => setF({ ...f, tlsDisableSystemRoot: v })} />
      <SwitchField id="tls-session-resumption" label="enableSessionResumption" checked={f.tlsEnableSessionResumption} onChange={(v) => setF({ ...f, tlsEnableSessionResumption: v })} />
    </AdvancedSection>
  )
}

function RealityFields({ f, setF }: { f: InboundFormState; setF: React.Dispatch<React.SetStateAction<InboundFormState>> }) {
  const t = useT()
  // 3x-ui pre-fills a full batch of shortIds the moment Reality becomes the
  // active security mode, rather than leaving the operator to build a list
  // by hand — a Reality inbound doesn't work without at least one, and
  // xray-core accepts any length from 1 to 8 bytes per id, so one of each
  // length (see keygenShortIds on the backend) is a sensible default set
  // instead of a single fixed-length value. This component only mounts
  // while security === "reality" (see NetworkSecurityFields), so mount is
  // exactly that moment. Guarded on the field still being empty at mount
  // time so it never clobbers a value already loaded from an existing
  // inbound (edit mode) or typed in.
  React.useEffect(() => {
    if (f.realityShortIds) return
    api.keygenShortIds().then(({ shortIds }) =>
      setF((s) => (s.realityShortIds ? s : { ...s, realityShortIds: shortIds.join(",") }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <AdvancedSection title={t("xray.reality.title")}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reality-target">{t("xray.reality.target")}</Label>
        <Input id="reality-target" value={f.realityTarget} onChange={(e) => setF({ ...f, realityTarget: e.target.value })} placeholder="example.com:443" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reality-sni">{t("xray.reality.serverNames")}</Label>
        <Input id="reality-sni" value={f.realityServerNames} onChange={(e) => setF({ ...f, realityServerNames: e.target.value })} />
      </div>
      <div className="flex flex-col gap-2">
        <Label>uTLS fingerprint</Label>
        <Select value={f.realityFingerprint} onValueChange={(v) => setF({ ...f, realityFingerprint: v ?? "" })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FINGERPRINTS.filter((fp) => fp).map((fp) => (
              <SelectItem key={fp} value={fp}>
                {fp}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <KeyInput
        id="reality-priv"
        label={t("xray.reality.privateKey")}
        value={f.realityPrivateKey}
        onChange={(v) => setF({ ...f, realityPrivateKey: v })}
        onGenerate={() =>
          api.keygenReality().then(({ privateKey, publicKey }) =>
            setF((s) => ({ ...s, realityPrivateKey: privateKey, realityPublicKey: publicKey }))
          )
        }
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="reality-pub">{t("xray.reality.publicKey")}</Label>
        <Input id="reality-pub" value={f.realityPublicKey} onChange={(e) => setF({ ...f, realityPublicKey: e.target.value })} className="font-mono text-xs" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reality-shortids">{t("xray.reality.shortIds")}</Label>
        <div className="flex gap-2">
          <Input
            id="reality-shortids"
            value={f.realityShortIds}
            onChange={(e) => setF({ ...f, realityShortIds: e.target.value })}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              api.keygenShortIds().then(({ shortIds }) => setF((s) => ({ ...s, realityShortIds: shortIds.join(",") })))
            }
          >
            {t("xray.reality.resetShortIds")}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reality-spiderx">SpiderX</Label>
        <Input id="reality-spiderx" value={f.realitySpiderX} onChange={(e) => setF({ ...f, realitySpiderX: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="reality-min-ver">Min client version</Label>
          <Input id="reality-min-ver" value={f.realityMinClientVer} onChange={(e) => setF({ ...f, realityMinClientVer: e.target.value })} placeholder="26.3.27" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reality-max-ver">Max client version</Label>
          <Input id="reality-max-ver" value={f.realityMaxClientVer} onChange={(e) => setF({ ...f, realityMaxClientVer: e.target.value })} placeholder="x.y.z" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reality-maxtimediff">{t("xray.reality.maxTimediff")}</Label>
        <Input id="reality-maxtimediff" type="number" value={f.realityMaxTimediff} onChange={(e) => setF({ ...f, realityMaxTimediff: e.target.value })} />
      </div>
      <p className="text-xs text-on-surface-variant">{t("xray.reality.advancedNote")}</p>
    </AdvancedSection>
  )
}

function FallbacksEditor({ f, setF }: { f: InboundFormState; setF: React.Dispatch<React.SetStateAction<InboundFormState>> }) {
  const t = useT()
  function update(i: number, patch: Partial<FallbackRow>) {
    setF({ ...f, fallbacks: f.fallbacks.map((fb, idx) => (idx === i ? { ...fb, ...patch } : fb)) })
  }
  function remove(i: number) {
    setF({ ...f, fallbacks: f.fallbacks.filter((_, idx) => idx !== i) })
  }
  function add() {
    setF({ ...f, fallbacks: [...f.fallbacks, { name: "", alpn: "", path: "", dest: "", xver: "0" }] })
  }
  return (
    <AdvancedSection title={`Fallbacks (${f.fallbacks.length})`}>
      {f.fallbacks.map((fb, i) => (
        <div key={i} className="grid grid-cols-2 items-end gap-2 rounded border p-2 sm:grid-cols-5">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">name</Label>
            <Input value={fb.name} onChange={(e) => update(i, { name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">alpn</Label>
            <Input value={fb.alpn} onChange={(e) => update(i, { alpn: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">path</Label>
            <Input value={fb.path} onChange={(e) => update(i, { path: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">dest</Label>
            <Input value={fb.dest} onChange={(e) => update(i, { dest: e.target.value })} placeholder={t("xray.fallbacks.destPlaceholder")} />
          </div>
          <Button type="button" variant="destructive" size="sm" onClick={() => remove(i)}>
            −
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        {t("xray.fallbacks.add")}
      </Button>
    </AdvancedSection>
  )
}

function NetworkFields({ f, setF }: { f: InboundFormState; setF: React.Dispatch<React.SetStateAction<InboundFormState>> }) {
  const t = useT()
  switch (f.network) {
    case "tcp":
      return (
        <>
          <div className="flex flex-col gap-2">
            <Label>Header type</Label>
            <Select value={f.tcpHeaderType} onValueChange={(v) => setF({ ...f, tcpHeaderType: v as InboundFormState["tcpHeaderType"] })}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => (v === "none" ? "None" : v === "http" ? "HTTP (camouflage)" : v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="http">HTTP (camouflage)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SwitchField id="tcp-proxy-proto" label="acceptProxyProtocol" checked={f.tcpAcceptProxyProtocol} onChange={(v) => setF({ ...f, tcpAcceptProxyProtocol: v })} />
        </>
      )
    case "ws":
      return (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ws-path">Path</Label>
              <Input id="ws-path" value={f.wsPath} onChange={(e) => setF({ ...f, wsPath: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ws-host">Host</Label>
              <Input id="ws-host" value={f.wsHost} onChange={(e) => setF({ ...f, wsHost: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-heartbeat">{t("xray.network.heartbeatPeriod")}</Label>
            <Input id="ws-heartbeat" type="number" value={f.wsHeartbeatPeriod} onChange={(e) => setF({ ...f, wsHeartbeatPeriod: e.target.value })} />
          </div>
          <SwitchField id="ws-proxy-proto" label="acceptProxyProtocol" checked={f.wsAcceptProxyProtocol} onChange={(v) => setF({ ...f, wsAcceptProxyProtocol: v })} />
        </>
      )
    case "grpc":
      return (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="grpc-service">Service name</Label>
            <Input id="grpc-service" value={f.grpcServiceName} onChange={(e) => setF({ ...f, grpcServiceName: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="grpc-authority">Authority</Label>
            <Input id="grpc-authority" value={f.grpcAuthority} onChange={(e) => setF({ ...f, grpcAuthority: e.target.value })} />
          </div>
          <SwitchField id="grpc-multimode" label="multiMode" checked={f.grpcMultiMode} onChange={(v) => setF({ ...f, grpcMultiMode: v })} />
        </>
      )
    case "kcp":
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="kcp-mtu">MTU</Label>
            <Input id="kcp-mtu" type="number" value={f.kcpMtu} onChange={(e) => setF({ ...f, kcpMtu: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kcp-tti">TTI</Label>
            <Input id="kcp-tti" type="number" value={f.kcpTti} onChange={(e) => setF({ ...f, kcpTti: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kcp-up">Uplink capacity</Label>
            <Input id="kcp-up" type="number" value={f.kcpUplinkCapacity} onChange={(e) => setF({ ...f, kcpUplinkCapacity: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kcp-down">Downlink capacity</Label>
            <Input id="kcp-down" type="number" value={f.kcpDownlinkCapacity} onChange={(e) => setF({ ...f, kcpDownlinkCapacity: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kcp-cwnd">cwndMultiplier</Label>
            <Input id="kcp-cwnd" type="number" value={f.kcpCwndMultiplier} onChange={(e) => setF({ ...f, kcpCwndMultiplier: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kcp-window">maxSendingWindow</Label>
            <Input id="kcp-window" type="number" value={f.kcpMaxSendingWindow} onChange={(e) => setF({ ...f, kcpMaxSendingWindow: e.target.value })} />
          </div>
        </div>
      )
    case "httpupgrade":
      return (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="hu-path">Path</Label>
              <Input id="hu-path" value={f.httpupgradePath} onChange={(e) => setF({ ...f, httpupgradePath: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hu-host">Host</Label>
              <Input id="hu-host" value={f.httpupgradeHost} onChange={(e) => setF({ ...f, httpupgradeHost: e.target.value })} />
            </div>
          </div>
          <SwitchField id="hu-proxy-proto" label="acceptProxyProtocol" checked={f.httpupgradeAcceptProxyProtocol} onChange={(v) => setF({ ...f, httpupgradeAcceptProxyProtocol: v })} />
        </>
      )
    case "xhttp":
      return (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="xhttp-path">Path</Label>
              <Input id="xhttp-path" value={f.xhttpPath} onChange={(e) => setF({ ...f, xhttpPath: e.target.value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="xhttp-host">Host</Label>
              <Input id="xhttp-host" value={f.xhttpHost} onChange={(e) => setF({ ...f, xhttpHost: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Mode</Label>
            <Select value={f.xhttpMode} onValueChange={(v) => setF({ ...f, xhttpMode: v as InboundFormState["xhttpMode"] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {XHTTP_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SwitchField id="xhttp-xmux" label={t("xray.network.xhttpXmuxLabel")} checked={f.xhttpEnableXmux} onChange={(v) => setF({ ...f, xhttpEnableXmux: v })} />
          {f.xhttpEnableXmux && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded border p-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">maxConcurrency</Label>
                <Input value={f.xhttpMaxConcurrency} onChange={(e) => setF({ ...f, xhttpMaxConcurrency: e.target.value })} placeholder="16-32" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">maxConnections</Label>
                <Input value={f.xhttpMaxConnections} onChange={(e) => setF({ ...f, xhttpMaxConnections: e.target.value })} placeholder="0" />
              </div>
            </div>
          )}
          <p className="text-xs text-on-surface-variant">{t("xray.network.antiDpiNote")}</p>
        </>
      )
  }
}

function NetworkSecurityFields({
  f,
  setF,
}: {
  f: InboundFormState
  setF: React.Dispatch<React.SetStateAction<InboundFormState>>
}) {
  const t = useT()
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>{t("xray.networkSecurity.transport")}</Label>
          <Select value={f.network} onValueChange={(v) => setF({ ...f, network: v as Network })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: Network | null) => (v ? NETWORK_LABELS[v] : null)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(NETWORK_LABELS) as Network[]).map((n) => (
                <SelectItem key={n} value={n}>
                  {NETWORK_LABELS[n]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("xray.networkSecurity.security")}</Label>
          <Select value={f.security} onValueChange={(v) => setF({ ...f, security: v as InboundFormState["security"] })}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  v === "none" ? "None" : v === "tls" ? "TLS" : v === "reality" ? "Reality" : v
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="tls">TLS</SelectItem>
              <SelectItem value="reality">Reality</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <NetworkFields f={f} setF={setF} />

      {f.security === "tls" && <TlsFields f={f} setF={setF} alpnDefault={["h2", "http/1.1"]} />}
      {f.security === "reality" && <RealityFields f={f} setF={setF} />}

      <FallbacksEditor f={f} setF={setF} />
    </>
  )
}

function InboundFormDialog({
  existing,
  nextNumber,
  onSaved,
}: {
  existing?: XrayInbound
  // Only meaningful for a brand-new inbound (existing is unset) — see
  // XrayPage's own call site, which passes inbounds.length + 1.
  nextNumber?: number
  onSaved: () => void
}) {
  const t = useT()
  // Lets the footer's submit button (rendered outside this <form>, so it
  // can stay pinned below the scrolling fields) still submit it via the
  // standard form="..." attribute — see the render below.
  const formId = React.useId()
  const defaultRemark = nextNumber ? `${t("xray.inboundForm.defaultNamePrefix")} #${nextNumber}` : ""
  const [open, setOpen] = React.useState(false)
  const [protocol, setProtocol] = React.useState<XrayProtocol>(existing?.Protocol ?? "vless")
  const [f, setF] = React.useState<InboundFormState>(existing ? formFromInbound(existing) : emptyForm(defaultRemark))
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setProtocol(existing?.Protocol ?? "vless")
      setF(existing ? formFromInbound(existing) : emptyForm(defaultRemark))
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const payload = buildPayload(protocol, f)
      if (existing) {
        await api.updateXrayInbound(existing.ID, payload)
      } else {
        await api.createXrayInbound(payload)
      }
      setOpen(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("xray.inboundForm.saveFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          existing ? (
            <Button variant="outline" size="sm" title={t("xray.inboundForm.editTrigger")}>
              <Icon name="edit" size={18} />
            </Button>
          ) : (
            <Button>{t("xray.inboundForm.addTrigger")}</Button>
          )
        }
      />
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden px-0 py-6 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-6">
          <DialogTitle>{existing ? t("xray.inboundForm.editTitle") : t("xray.inboundForm.createTitle")}</DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit} className="contents">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
          <SwitchField id="inbound-enable" label={t("xray.inboundForm.enabled")} checked={f.enable} onChange={(v) => setF({ ...f, enable: v })} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="inbound-remark">{t("xray.inboundForm.remark")}</Label>
            <Input id="inbound-remark" value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} required autoFocus />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("xray.inboundForm.protocol")}</Label>
            <Select value={protocol} onValueChange={(v) => setProtocol(v as XrayProtocol)} disabled={!!existing}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: XrayProtocol | null) => (v ? PROTOCOL_LABELS[v] : null)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROTOCOL_LABELS) as XrayProtocol[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROTOCOL_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {existing && (
              <p className="text-xs text-on-surface-variant">
                {t("xray.inboundForm.protocolLocked")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="inbound-listen">{t("xray.inboundForm.listen")}</Label>
              <Input id="inbound-listen" value={f.listen} onChange={(e) => setF({ ...f, listen: e.target.value })} placeholder="0.0.0.0" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="inbound-port">{t("xray.inboundForm.port")}</Label>
              <Input
                id="inbound-port"
                type="number"
                value={f.port}
                onChange={(e) => setF({ ...f, port: e.target.value })}
                required
                placeholder="443"
              />
            </div>
          </div>

          {(protocol === "vless" || protocol === "trojan") && <NetworkSecurityFields f={f} setF={setF} />}

          {protocol === "hysteria2" && (
            <>
              <p className="text-xs text-on-surface-variant">
                {t("xray.inboundForm.hysteria2Note")}
              </p>
              <TlsFields f={f} setF={setF} alpnDefault={["h3"]} />
            </>
          )}

          {protocol === "wireguard" && (
            <>
              <KeyInput
                id="wg-secret"
                label={t("xray.inboundForm.wgSecretKey")}
                value={f.wgSecretKey}
                onChange={(v) => setF({ ...f, wgSecretKey: v })}
                onGenerate={() =>
                  api.keygenWireGuard().then(({ privateKey, publicKey }) =>
                    setF((s) => ({ ...s, wgSecretKey: privateKey, wgPublicKey: publicKey }))
                  )
                }
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="wg-pub">{t("xray.inboundForm.wgPublicKey")}</Label>
                <Input id="wg-pub" value={f.wgPublicKey} onChange={(e) => setF({ ...f, wgPublicKey: e.target.value })} className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wg-address">{t("xray.inboundForm.wgAddress")}</Label>
                  <Input id="wg-address" value={f.wgAddress} onChange={(e) => setF({ ...f, wgAddress: e.target.value })} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="wg-mtu">MTU</Label>
                  <Input id="wg-mtu" type="number" value={f.wgMtu} onChange={(e) => setF({ ...f, wgMtu: e.target.value })} />
                </div>
              </div>
            </>
          )}

          <AdvancedSection title="Sniffing">
            <SwitchField id="sniffing-enabled" label={t("xray.inboundForm.sniffingEnable")} checked={f.sniffingEnabled} onChange={(v) => setF({ ...f, sniffingEnabled: v })} />
            {f.sniffingEnabled && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="sniffing-dest">{t("xray.inboundForm.sniffingDestOverride")}</Label>
                <Input
                  id="sniffing-dest"
                  value={f.sniffingDestOverride}
                  onChange={(e) => setF({ ...f, sniffingDestOverride: e.target.value })}
                />
              </div>
            )}
          </AdvancedSection>

          {error && <p className="text-sm text-error">{error}</p>}
        </div>
        </form>
        <DialogFooter className="shrink-0 px-6">
          <Button type="submit" form={formId} disabled={loading}>
            {loading ? t("xray.inboundForm.saving") : existing ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClientIdentity({ config }: { config: string }) {
  const t = useT()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(config)
  } catch {
    return <span className="font-mono text-xs text-on-surface-variant">{config}</span>
  }
  const identityKeys = ["id", "flow", "password", "auth", "privateKey", "publicKey"]
  const identity = identityKeys
    .filter((k) => parsed[k] !== undefined && parsed[k] !== "")
    .map((k) => `${k}=${parsed[k]}`)
    .join(" ")
  const totalGB = typeof parsed.totalGB === "number" && parsed.totalGB > 0 ? `${(parsed.totalGB / 1024 ** 3).toFixed(1)} GB` : "∞"
  const expiry =
    typeof parsed.expiryTime === "number" && parsed.expiryTime > 0
      ? new Date(parsed.expiryTime).toLocaleDateString()
      : "—"
  return (
    <div className="flex flex-col">
      <span className="font-mono text-xs text-on-surface-variant">{identity || "—"}</span>
      <span className="text-xs text-on-surface-variant">
        {t("xray.clientIdentity.traffic")}: {totalGB} · {t("xray.clientIdentity.ipLimit")}: {typeof parsed.limitIp === "number" && parsed.limitIp > 0 ? parsed.limitIp : "∞"} · {t("xray.clientIdentity.until")}: {expiry} ·{" "}
        {parsed.enable === false ? t("xray.clientIdentity.disabled") : t("xray.clientIdentity.enabled")}
      </span>
    </div>
  )
}

// InboundClientsDialog manages which panel Clients are attached to one
// inbound. Deliberately only offers clients that already exist on the
// Clients page — there is no way to create an "xray-only" client here,
// matching the rule that Xray never has clients the Clients page doesn't.
function InboundClientsDialog({ inbound, allClients, onChanged }: { inbound: XrayInbound; allClients: Client[]; onChanged: () => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [attached, setAttached] = React.useState<XrayClient[]>(inbound.Clients ?? [])
  const [pickClientId, setPickClientId] = React.useState<string>("")
  const [trafficGB, setTrafficGB] = React.useState("0")
  const [limitIp, setLimitIp] = React.useState("0")
  const [expiryDate, setExpiryDate] = React.useState("")
  const [comment, setComment] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setAttached(inbound.Clients ?? [])
  }, [open, inbound])

  const attachedClientIds = new Set(attached.map((xc) => xc.ClientID))
  const available = allClients.filter((c) => !attachedClientIds.has(c.ID))

  async function handleAttach() {
    if (!pickClientId) return
    setBusy(true)
    setError(null)
    try {
      const xc = await api.attachXrayClient(inbound.ID, Number(pickClientId), {
        totalGB: (Number(trafficGB) || 0) * 1024 ** 3,
        limitIp: Number(limitIp) || 0,
        expiryTime: expiryDate ? new Date(expiryDate).getTime() : 0,
        comment,
      })
      setAttached((s) => [...s, xc])
      setPickClientId("")
      setTrafficGB("0")
      setLimitIp("0")
      setExpiryDate("")
      setComment("")
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("xray.inboundClients.attachFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function handleDetach(xrayClientId: number) {
    setBusy(true)
    try {
      await api.detachXrayClient(xrayClientId)
      setAttached((s) => s.filter((xc) => xc.ID !== xrayClientId))
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  function clientName(clientId: number) {
    return allClients.find((c) => c.ID === clientId)?.Name ?? `#${clientId}`
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t("xray.inboundClients.trigger")} ({(inbound.Clients ?? []).length})
          </Button>
        }
      />
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden px-0 py-6 sm:max-w-lg">
        <DialogHeader className="shrink-0 px-6">
          <DialogTitle>{t("xray.inboundClients.title")} «{inbound.Remark}»</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
          <div className="flex flex-col gap-2 rounded-md border p-3">
            {attached.length === 0 && <p className="text-sm text-on-surface-variant">{t("xray.inboundClients.none")}</p>}
            {attached.map((xc) => (
              <div key={xc.ID} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex flex-col">
                  <span>{clientName(xc.ClientID)}</span>
                  <ClientIdentity config={xc.Config} />
                </div>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => handleDetach(xc.ID)}>
                  {t("xray.inboundClients.detach")}
                </Button>
              </div>
            ))}
          </div>

          {available.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-2">
                <Label>{t("xray.inboundClients.clientLabel")}</Label>
                <Select value={pickClientId} onValueChange={(v) => setPickClientId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("xray.inboundClients.pickPlaceholder")}>
                      {(v: string | null) => available.find((c) => String(c.ID) === v)?.Name ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((c) => (
                      <SelectItem key={c.ID} value={String(c.ID)}>
                        {c.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="attach-traffic" className="min-h-10">
                    {t("xray.inboundClients.trafficLimit")}
                  </Label>
                  <Input id="attach-traffic" type="number" value={trafficGB} onChange={(e) => setTrafficGB(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="attach-ip" className="min-h-10">
                    {t("xray.inboundClients.ipLimit")}
                  </Label>
                  <Input id="attach-ip" type="number" value={limitIp} onChange={(e) => setLimitIp(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="attach-expiry">{t("xray.inboundClients.expiry")}</Label>
                <Input id="attach-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="attach-comment">{t("xray.inboundClients.comment")}</Label>
                <Input id="attach-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              <Button type="button" disabled={!pickClientId || busy} onClick={handleAttach}>
                {t("xray.inboundClients.attach")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">
              {t("xray.inboundClients.allAttached")}
            </p>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function XrayLogsDialog() {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [log, setLog] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const [pid, setPid] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const logRef = React.useRef<HTMLPreElement | null>(null)
  const pollRef = React.useRef<number | null>(null)

  async function fetchAll() {
    setError(null)
    try {
      const [status, logs] = await Promise.all([api.getXrayStatus(), api.getXrayLogs()])
      setRunning(status.running)
      setPid(status.pid)
      setLog(logs.log)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profileLogs.loadFailed"))
    } finally {
      setLoading(false)
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setLoading(true)
      fetchAll()
      pollRef.current = window.setInterval(fetchAll, 3000)
    } else if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  React.useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline">{t("xray.logsDialog.trigger")}</Button>} />
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("xray.logsDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={running ? "default" : "secondary"}>{running ? t("profileLogs.running") : t("profileLogs.notRunning")}</Badge>
          {running && pid > 0 && <span className="text-on-surface-variant">PID {pid}</span>}
          <Button size="sm" variant="outline" className="ml-auto" onClick={fetchAll} disabled={loading}>
            {t("profileLogs.refresh")}
          </Button>
        </div>
        {error && <p className="text-sm text-error">{error}</p>}
        <pre
          ref={logRef}
          className="max-h-[55vh] overflow-auto rounded-md border bg-surface-variant/30 p-3 text-xs whitespace-pre-wrap"
        >
          {log || (loading ? t("common.loading") : t("profileLogs.empty"))}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

function XrayStatusBadge() {
  const t = useT()
  const [status, setStatus] = React.useState<{ running: boolean; pid: number } | null>(null)
  const [kernel, setKernel] = React.useState<KernelStatus | null>(null)

  React.useEffect(() => {
    const load = () => api.getXrayStatus().then(setStatus).catch(() => setStatus(null))
    load()
    const id = window.setInterval(load, 5000)
    return () => window.clearInterval(id)
  }, [])

  React.useEffect(() => {
    api
      .listKernels()
      .then((ks) => setKernel(ks.find((k) => k.coreType === "xray") ?? null))
      .catch(() => setKernel(null))
  }, [])

  return (
    <div className="flex items-center gap-2">
      {status && (
        <Badge variant={status.running ? "default" : "secondary"}>
          {status.running ? `${t("xray.statusBadge.running")} · PID ${status.pid}` : t("xray.statusBadge.notRunning")}
        </Badge>
      )}
      {kernel?.installed ? (
        <Badge variant="outline">{kernel.version || t("xray.statusBadge.versionUnknown")}</Badge>
      ) : (
        <Link to="/kernels" className="text-xs text-on-surface-variant underline">
          {t("xray.statusBadge.notInstalled")}
        </Link>
      )}
    </div>
  )
}

export function XrayPage() {
  const t = useT()
  const { confirm } = useDialogPrompt()
  const [inbounds, setInbounds] = React.useState<XrayInbound[]>([])
  const [clients, setClients] = React.useState<Client[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    api
      .listXrayInbounds()
      .then(setInbounds)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    api.listClients().then(setClients).catch(() => setClients([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function handleDelete(id: number) {
    if (
      !(await confirm(t("xray.page.deleteConfirm"), {
        destructive: true,
        confirmLabel: t("common.delete"),
      }))
    )
      return
    await api.deleteXrayInbound(id)
    load()
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Xray</h1>
            <XrayStatusBadge />
          </div>
          <p className="text-sm text-on-surface-variant">
            {t("xray.page.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <XrayLogsDialog />
          <InboundFormDialog nextNumber={inbounds.length + 1} onSaved={load} />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-error">{error}</p>}

      <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("xray.page.colStatus")}</TableHead>
              <TableHead>{t("xray.page.colProtocol")}</TableHead>
              <TableHead>{t("xray.page.colName")}</TableHead>
              <TableHead>{t("xray.page.colAddress")}</TableHead>
              <TableHead>{t("xray.page.colClients")}</TableHead>
              <TableHead className="text-right">{t("xray.page.colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inbounds.map((ib) => (
              <TableRow key={ib.ID}>
                <TableCell>
                  <span
                    className={`inline-block size-2 rounded-full ${ib.Enable ? "bg-green-500" : "bg-on-surface-variant/40"}`}
                    title={ib.Enable ? t("xray.clientIdentity.enabled") : t("xray.clientIdentity.disabled")}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{PROTOCOL_LABELS[ib.Protocol]}</Badge>
                </TableCell>
                <TableCell>{ib.Remark}</TableCell>
                <TableCell className="font-mono text-xs text-on-surface-variant">
                  {ib.Listen || "0.0.0.0"}:{ib.Port}
                </TableCell>
                <TableCell>
                  <InboundClientsDialog inbound={ib} allClients={clients} onChanged={load} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <InboundFormDialog existing={ib} onSaved={load} />
                    <Button size="sm" variant="destructive" title={t("common.delete")} onClick={() => handleDelete(ib.ID)}>
                      <Icon name="delete" size={18} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {inbounds.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-on-surface-variant">
                  {t("xray.page.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
    </div>
  )
}
