package freeturn

// profileCoreConfig is what we store (as JSON) in models.Profile.CoreConfig
// for CoreFreeTurn profiles.
//
// Port and ObfKey are infra: minted once and kept stable, since the client's
// freeturn:// URI bakes them in and rotating ObfKey would break every client.
// Provider/Links/Transport only affect the client-facing JSON payload, never
// server flags, so editing them never restarts the process; ConnectHost/
// ConnectPort/ObfProfile/ObfTiming do affect flags and do restart it.
//
// There's no clients.json allowlist here — one process per profile already
// scopes access via the (secret) obf-key and port.
type profileCoreConfig struct {
	Provider  string   `json:"provider"`  // "vk"
	Links     []string `json:"links"`     // bare VK Calls ids (e.g. "ABC123xyz"), not full https://vk.com/call/join/... links
	Transport string   `json:"transport"` // "tcp" or "udp", must match server -obf-profile expectations

	// Mode is the tunnel type ("-mode", must match on client and server):
	// "udp" (default) relays UDP transparently (WireGuard/Hysteria); "tcp"
	// forwards a TCP stream via KCP+smux over the UDP-only TURN relay (Xray/sing-box/VLESS).
	Mode string `json:"mode,omitempty"`

	// KCP tunes the ARQ layer ("-kcp-*" flags), only valid when Mode ==
	// "tcp". nil means "use the binary's own defaults", not "all zero" — 0 is itself meaningful for NoDelay/NC.
	KCP *kcpOpts `json:"kcp,omitempty"`

	ConnectHost string `json:"connect_host,omitempty"` // local backend's host, e.g. 127.0.0.1
	ConnectPort int    `json:"connect_port,omitempty"` // required, no default — depends on the local service

	ObfProfile string `json:"obf_profile,omitempty"` // "rtpopus" (default/recommended), "rtpopus2", "rtpopus3", or "none"
	ObfKey     string `json:"obf_key,omitempty"`     // 64 hex chars, required unless ObfProfile is "none"
	ObfTiming  string `json:"obf_timing,omitempty"`  // e.g. "10ms" inter-packet delay for RTP mimicry; only with ObfProfile != "none"

	Port int `json:"port"`
}

// kcpOpts mirrors free-turn-proxy's own "kcp" wire object exactly, so it
// embeds verbatim in both stored CoreConfig and the client-facing freeturnURI without remapping.
type kcpOpts struct {
	NoDelay    int  `json:"nodelay"`
	Interval   int  `json:"interval"`
	Resend     int  `json:"resend"`
	NC         int  `json:"nc"`
	SndWnd     int  `json:"sndwnd"`
	RcvWnd     int  `json:"rcvwnd"`
	MTU        int  `json:"mtu"`
	ACKNoDelay bool `json:"acknodelay"`
}

// freeturnURI mirrors the base64url(JSON) payload from upstream docs/uri.md.
// WireTurn's parser reads "links" via Gson's asString, so it MUST be a
// comma-joined string, never a JSON array — it used to be []string, which
// Gson can't coerce, silently failing the entire URI import.
type freeturnURI struct {
	V         int      `json:"v"`
	Provider  string   `json:"provider"`
	Peer      string   `json:"peer"`            // host:port of this profile's dedicated freeturn server process
	Links     string   `json:"links,omitempty"` // comma-joined bare VK Calls ids
	Sub       string   `json:"sub,omitempty"`
	Transport string   `json:"transport,omitempty"` // omitted at the "tcp" default, matching the app's own generator
	Mode      string   `json:"mode,omitempty"`      // omitted at the "udp" default, matching the app's own generator
	KCP       *kcpOpts `json:"kcp,omitempty"`       // only set when Mode == "tcp" — see kcpOpts' own doc comment

	// Obf/Key/Obft must mirror the -obf-profile/-obf-key/-obf-timing flags
	// the server actually runs with (see ensureProcess), or the client can't
	// talk to it. Obf is only written when not "none".
	Obf  string `json:"obf,omitempty"`
	Key  string `json:"key,omitempty"`
	Obft string `json:"obft,omitempty"`
}
