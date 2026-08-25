declare global {
  interface Window {
    __WTP_BASE_PATH__?: string
  }
}

// BASE_PATH is injected into index.html at serve time by the Go backend
// (see server.serveWebUI) — every route here is written as if the app were
// mounted at "/", but the panel's actual URI-path setting (Settings page)
// can put it under an arbitrary prefix. Every fetch() and the router's
// basename (see App.tsx) both need this to resolve correctly; "" (empty
// string, not "/") so simple concatenation with a leading-"/" path never
// produces a double slash.
export const BASE_PATH = (window.__WTP_BASE_PATH__ ?? "/").replace(/\/$/, "")

const TOKEN_KEY = "wtpanel_token"

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// timeoutMs is deliberately not part of RequestInit — fetch() has no
// built-in timeout, and most callers here are fine waiting on whatever the
// browser's own TCP/TLS timeouts eventually decide. It exists for callers
// that poll in a loop where a single hung request must not be able to wedge
// that loop forever — see SettingsPage's PanelRestartDialog for why.
async function request<T>(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const token = getToken()
  const headers = new Headers(options.headers)
  headers.set("Content-Type", "application/json")
  if (token) headers.set("Authorization", `Bearer ${token}`)

  let signal = options.signal
  let timer: number | undefined
  if (timeoutMs) {
    const controller = new AbortController()
    timer = window.setTimeout(() => controller.abort(), timeoutMs)
    // Merge rather than replace: a caller-supplied signal (e.g. an
    // unmount-triggered abort) must keep working even when timeoutMs is
    // also set, instead of being silently overridden by the timeout one.
    signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  }

  let res: Response
  try {
    res = await fetch(BASE_PATH + path, { ...options, headers, signal })
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
  if (res.status === 401) {
    clearToken()
    window.location.href = BASE_PATH + "/login"
    throw new ApiError(401, "unauthorized")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, body.error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// downloadFile fetches an authenticated endpoint that responds with
// Content-Disposition: attachment and saves it client-side — a plain <a
// href> can't carry the Bearer token, so the file has to come through
// fetch() and get handed to the browser as an object URL instead.
async function downloadFile(path: string): Promise<void> {
  const token = getToken()
  const headers = new Headers()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(BASE_PATH + path, { headers })
  if (res.status === 401) {
    clearToken()
    window.location.href = BASE_PATH + "/login"
    throw new ApiError(401, "unauthorized")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, body.error ?? res.statusText)
  }
  const blob = await res.blob()
  const disposition = res.headers.get("Content-Disposition") ?? ""
  const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? "wt_export.json"

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export type CoreType = "turnable" | "olcrtc" | "webdav" | "freeturn"

export interface Profile {
  ID: number
  ExternalID: string
  Name: string
  CoreType: CoreType
  CoreConfig: string
  Enabled: boolean
  XrayEnabled: boolean
  XrayInboundID: number | null
  XrayInbound: XrayInbound | null
  XrayManualURI: string
  XrayManualWireGuard: string
  XrayDualRoute: boolean
  XrayDirectAddress: string
  XrayHcInterval: string
  XrayMux: string
  KernelURI: string
  Running: boolean
  PID?: number
}

export interface Client {
  ID: number
  Name: string
  Enabled: boolean
  ExpiresAt: string | null
  TrafficLimitByte: number
  TrafficUsedByte: number
  Description: string
  UpdateIntervalMinutes: number
  Profiles: Profile[]
}

export interface SystemStats {
  cpuPercent: number
  cpuCores: number
  memUsedBytes: number
  memTotalBytes: number
  diskUsedBytes: number
  diskTotalBytes: number
}

export interface KernelStatus {
  // "xray" is a real value here (Xray-core's own install/version tracking on
  // the "Ядра" page) but deliberately not part of CoreType — that type is
  // for Profile.CoreType, and xray-core is never a per-profile kernel (see
  // models.CoreXray's doc comment).
  coreType: CoreType | "xray"
  installed: boolean
  version?: string
  source?: "release" | "build"
  installedAt?: string
  binPath: string
}

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface Release {
  tag_name: string
  name: string
  published_at: string
  prerelease: boolean
  assets: ReleaseAsset[]
}

export interface Commit {
  sha: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
}

export interface BuildJob {
  id: string
  kernel: string
  ref: string
  status: "running" | "success" | "failed"
  log: string
  version: string
  startedAt: string
  finishedAt?: string
}

export type RoomProvider = "vk" | "wbstream" | "telemost" | "jitsi"

export interface CallRoom {
  ID: number
  Provider: RoomProvider
  RoomID: string
  Label: string
  Notes: string
  LastCheckedAt: string | null
  Valid: boolean | null
}

export type XrayProtocol = "vless" | "trojan" | "hysteria2" | "wireguard"

export interface XrayClient {
  ID: number
  InboundID: number
  ClientID: number
  Config: string
  Enable: boolean
}

export interface PanelSettings {
  ID: number
  ListenIP: string
  ListenDomain: string
  ListenPort: number
  BasePath: string
  TLSCertFile: string
  TLSKeyFile: string
  PublicIP: string
  WebDAVPublicHost: string
}

export interface PanelSettingsInput {
  listenIp: string
  listenDomain: string
  listenPort: number
  basePath: string
  tlsCertFile: string
  tlsKeyFile: string
  publicIp: string
  webdavPublicHost: string
}

export interface XrayInbound {
  ID: number
  Protocol: XrayProtocol
  Remark: string
  Listen: string
  Port: number
  Enable: boolean
  Settings: string
  StreamSettings: string
  Sniffing: string
  Clients: XrayClient[] | null
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  listClients: () => request<Client[]>("/api/clients"),

  createClient: (input: {
    name: string
    trafficLimitByte: number
    description?: string
    updateIntervalMinutes?: number
  }) =>
    request<Client>("/api/clients", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        trafficLimitByte: input.trafficLimitByte,
        description: input.description ?? "",
        updateIntervalMinutes: input.updateIntervalMinutes ?? 60,
      }),
    }),

  // enabled/expiresAt aren't exposed in the edit UI (yet) — the caller
  // always echoes the client's current values back unchanged, since the
  // backend treats an absent expiresAt as "clear it", not "leave it alone".
  updateClient: (
    id: number,
    input: {
      name: string
      trafficLimitByte: number
      description?: string
      updateIntervalMinutes?: number
      enabled: boolean
      expiresAt: number | null
    }
  ) =>
    request<Client>(`/api/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: input.name,
        trafficLimitByte: input.trafficLimitByte,
        description: input.description ?? "",
        updateIntervalMinutes: input.updateIntervalMinutes ?? 60,
        enabled: input.enabled,
        expiresAt: input.expiresAt,
      }),
    }),

  deleteClient: (id: number) =>
    request<void>(`/api/clients/${id}`, { method: "DELETE" }),

  createProfile: (
    clientId: number,
    input: {
      name: string
      coreType: CoreType
      coreConfig?: unknown
      enabled?: boolean
      xrayEnabled?: boolean
      xrayInboundId?: number | null
      xrayManualUri?: string
      xrayManualWireGuard?: string
      xrayDualRoute?: boolean
      xrayDirectAddress?: string
      xrayHcInterval?: string
      xrayMux?: string
    }
  ) =>
    request<Profile>(`/api/clients/${clientId}/profiles`, {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        coreType: input.coreType,
        coreConfig: input.coreConfig ?? {},
        enabled: input.enabled ?? true,
        xrayEnabled: input.xrayEnabled ?? false,
        xrayInboundId: input.xrayInboundId ?? null,
        xrayManualUri: input.xrayManualUri ?? "",
        xrayManualWireGuard: input.xrayManualWireGuard ?? "",
        xrayDualRoute: input.xrayDualRoute ?? false,
        xrayDirectAddress: input.xrayDirectAddress ?? "",
        xrayHcInterval: input.xrayHcInterval ?? "",
        xrayMux: input.xrayMux ?? "",
      }),
    }),

  updateProfile: (
    id: number,
    input: {
      name: string
      coreType: CoreType
      coreConfig?: unknown
      enabled?: boolean
      xrayEnabled?: boolean
      xrayInboundId?: number | null
      xrayManualUri?: string
      xrayManualWireGuard?: string
      xrayDualRoute?: boolean
      xrayDirectAddress?: string
      xrayHcInterval?: string
      xrayMux?: string
    }
  ) =>
    request<Profile>(`/api/profiles/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: input.name,
        coreType: input.coreType,
        coreConfig: input.coreConfig ?? {},
        enabled: input.enabled ?? true,
        xrayEnabled: input.xrayEnabled ?? false,
        xrayInboundId: input.xrayInboundId ?? null,
        xrayManualUri: input.xrayManualUri ?? "",
        xrayManualWireGuard: input.xrayManualWireGuard ?? "",
        xrayDualRoute: input.xrayDualRoute ?? false,
        xrayDirectAddress: input.xrayDirectAddress ?? "",
        xrayHcInterval: input.xrayHcInterval ?? "",
        xrayMux: input.xrayMux ?? "",
      }),
    }),

  deleteProfile: (id: number) =>
    request<void>(`/api/profiles/${id}`, { method: "DELETE" }),

  restartProfile: (id: number) =>
    request<Profile>(`/api/profiles/${id}/restart`, { method: "POST" }),

  getProfileLogs: (id: number, tail?: number) =>
    request<{ log: string; running: boolean; pid: number }>(
      `/api/profiles/${id}/logs${tail ? `?tail=${tail}` : ""}`
    ),

  createSubscriptionToken: (clientId: number) =>
    request<{ token: string; url: string }>(
      `/api/clients/${clientId}/subscription-token`,
      { method: "POST" }
    ),

  getSubscriptionLinks: (clientId: number) =>
    request<{
      url: string
      wireturnLink: string
    }>(`/api/clients/${clientId}/subscription-links`),
  downloadClientExport: (clientId: number) => downloadFile(`/api/clients/${clientId}/export`),

  getProfileLinks: (profileId: number) =>
    request<{ kernelUri: string; wireturnLink: string }>(`/api/profiles/${profileId}/links`),
  downloadProfileExport: (profileId: number) => downloadFile(`/api/profiles/${profileId}/export`),

  keygenTurnable: () =>
    request<{ pubKey: string; privKey: string }>("/api/keygen/turnable", { method: "POST" }),

  keygenHex32: () => request<{ key: string }>("/api/keygen/hex32", { method: "POST" }),

  listKernels: () => request<KernelStatus[]>("/api/kernels"),

  // listTurnableReleases (and the three list* below) hit a backend cache
  // (10 min TTL, see kernels.ListReleases/ListCommits) rather than GitHub
  // directly every time — refresh:true bypasses it, for the "обновить
  // список" button.
  listTurnableReleases: (refresh?: boolean) =>
    request<Release[]>(`/api/kernels/turnable/releases${refresh ? "?refresh=1" : ""}`),
  installTurnable: (version?: string) =>
    request<BuildJob>("/api/kernels/turnable/install", {
      method: "POST",
      body: JSON.stringify({ version: version ?? "" }),
    }),

  listFreeTurnReleases: (refresh?: boolean) =>
    request<Release[]>(`/api/kernels/freeturn/releases${refresh ? "?refresh=1" : ""}`),
  installFreeTurn: (version?: string) =>
    request<BuildJob>("/api/kernels/freeturn/install", {
      method: "POST",
      body: JSON.stringify({ version: version ?? "" }),
    }),

  listXrayReleases: (refresh?: boolean) =>
    request<Release[]>(`/api/kernels/xray/releases${refresh ? "?refresh=1" : ""}`),
  installXray: (version?: string) =>
    request<BuildJob>("/api/kernels/xray/install", {
      method: "POST",
      body: JSON.stringify({ version: version ?? "" }),
    }),

  listWebdavReleases: (refresh?: boolean) =>
    request<Release[]>(`/api/kernels/webdav/releases${refresh ? "?refresh=1" : ""}`),
  installWebdav: (version?: string) =>
    request<BuildJob>("/api/kernels/webdav/install", {
      method: "POST",
      body: JSON.stringify({ version: version ?? "" }),
    }),

  listOlcrtcCommits: (refresh?: boolean) =>
    request<Commit[]>(`/api/kernels/olcrtc/commits${refresh ? "?refresh=1" : ""}`),
  buildOlcrtc: (ref: string) =>
    request<BuildJob>("/api/kernels/olcrtc/build", {
      method: "POST",
      body: JSON.stringify({ ref }),
    }),

  // getKernelJob asks "what's the latest job for this kernel" — keyed by
  // name, not a job id, so a component can resume showing progress (or the
  // last result) after a full page reload without having remembered
  // anything itself. null (not a throw) when this kernel has never had a
  // job, which is the common case right after the panel starts.
  getKernelJob: async (kernelName: string, timeoutMs?: number): Promise<BuildJob | null> => {
    try {
      return await request<BuildJob>(`/api/kernels/job/${kernelName}`, {}, timeoutMs)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },

  listCallRooms: (provider?: RoomProvider) =>
    request<CallRoom[]>(`/api/rooms${provider ? `?provider=${provider}` : ""}`),
  createCallRoom: (input: { provider: RoomProvider; roomId: string; label?: string; notes?: string }) =>
    request<CallRoom>("/api/rooms", { method: "POST", body: JSON.stringify(input) }),
  updateCallRoom: (id: number, input: { provider: RoomProvider; roomId: string; label?: string; notes?: string }) =>
    request<CallRoom>(`/api/rooms/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteCallRoom: (id: number) => request<void>(`/api/rooms/${id}`, { method: "DELETE" }),

  listXrayInbounds: () => request<XrayInbound[]>("/api/xray/inbounds"),
  createXrayInbound: (input: {
    protocol: XrayProtocol
    remark: string
    listen?: string
    port: number
    enable?: boolean
    settings?: unknown
    streamSettings?: unknown
    sniffing?: unknown
  }) => request<XrayInbound>("/api/xray/inbounds", { method: "POST", body: JSON.stringify(input) }),
  updateXrayInbound: (
    id: number,
    input: {
      protocol: XrayProtocol
      remark: string
      listen?: string
      port: number
      enable?: boolean
      settings?: unknown
      streamSettings?: unknown
      sniffing?: unknown
    }
  ) => request<XrayInbound>(`/api/xray/inbounds/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteXrayInbound: (id: number) => request<void>(`/api/xray/inbounds/${id}`, { method: "DELETE" }),

  listInboundClients: (inboundId: number) =>
    request<XrayClient[]>(`/api/xray/inbounds/${inboundId}/clients`),
  attachXrayClient: (
    inboundId: number,
    clientId: number,
    common?: { limitIp?: number; totalGB?: number; expiryTime?: number; enable?: boolean; comment?: string }
  ) =>
    request<XrayClient>(`/api/xray/inbounds/${inboundId}/clients`, {
      method: "POST",
      body: JSON.stringify({ clientId, ...common }),
    }),
  detachXrayClient: (xrayClientId: number) =>
    request<void>(`/api/xray/clients/${xrayClientId}`, { method: "DELETE" }),

  getSystemStats: () => request<SystemStats>("/api/system/stats"),

  getXrayStatus: () => request<{ running: boolean; pid: number }>("/api/xray/status"),
  getXrayLogs: (tail?: number) =>
    request<{ log: string }>(`/api/xray/logs${tail ? `?tail=${tail}` : ""}`),

  keygenWireGuard: () =>
    request<{ privateKey: string; publicKey: string }>("/api/keygen/wireguard", { method: "POST" }),
  keygenReality: () =>
    request<{ privateKey: string; publicKey: string }>("/api/keygen/reality", { method: "POST" }),
  keygenShortIds: () => request<{ shortIds: string[] }>("/api/keygen/short-ids", { method: "POST" }),

  getPanelSettings: () => request<PanelSettings>("/api/settings/panel"),
  updatePanelSettings: (input: PanelSettingsInput) =>
    request<{ settings: PanelSettings; restartRequired: boolean }>("/api/settings/panel", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  restartPanel: () => request<{ restarting: boolean }>("/api/settings/panel/restart", { method: "POST" }),
  checkPanelUpdate: () =>
    request<{ currentVersion: string; latestVersion: string; updateAvailable: boolean }>(
      "/api/settings/panel/update-check"
    ),
  updatePanel: () =>
    request<{ updating: boolean; version: string }>("/api/settings/panel/update", { method: "POST" }),

  getAccount: () => request<{ username: string }>("/api/account"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/account/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getSettings: (timeoutMs?: number) => request<Record<string, string>>("/api/settings", {}, timeoutMs),
}
