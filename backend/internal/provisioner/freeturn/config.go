package freeturn

// profileCoreConfig is what we store (as JSON) in models.Profile.CoreConfig
// for CoreFreeTurn profiles.
//
// Port is infra: filled in on first AddProfile call if left empty and never
// re-minted by UpdateProfile, since the client's freeturn:// URI already
// has it baked in as "peer". ObfKey is infra the same way — generated once
// (or supplied by the operator) and kept stable, since rotating it would
// break every client using this profile.
//
// Provider/Links/Transport are logical — they only affect the JSON payload
// handed to the client, never the server process's own flags, so editing
// them never needs a restart. ConnectHost/ConnectPort/ObfProfile/ObfTiming
// ARE logical but DO affect the process's flags, so changing them restarts
// it.
//
// There is deliberately no clients.json / Client ID allowlist here: with
// one dedicated process per profile, access is already scoped by the
// (secret) obf-key and port, so -clients-file is never set (same as the
// plain systemd/Docker examples in docs/deploy.md).
//
// VK Calls ids are the caller's responsibility to supply (single-use
// meeting ids, not something the panel can mint) — the panel just stores
// and re-embeds them. Despite the field's name, this holds bare call ids
// (e.g. "ABC123xyz..."), the same thing Turnable's call_id takes — not full
// https://vk.com/call/join/... links.
type profileCoreConfig struct {
	Provider  string   `json:"provider"`  // "vk"
	Links     []string `json:"links"`     // VK Calls ids, per docs/providers.md
	Transport string   `json:"transport"` // "tcp" or "udp", must match server -obf-profile expectations

	// Mode is the tunnel type ("-mode" on both client and server, must
	// match — see upstream docs/modes.md): "udp" (default) relays UDP
	// datagrams transparently, for WireGuard/Hysteria backends; "tcp"
	// forwards a TCP stream (KCP+smux over the same UDP-only TURN relay),
	// for Xray/sing-box/VLESS-style backends.
	Mode string `json:"mode,omitempty"`

	// KCP tunes the ARQ layer carrying that TCP stream (the "-kcp-*"
	// flags), only meaningful (and only valid to pass to the process at
	// all) when Mode == "tcp" — nil means "let the binary use its own
	// built-in defaults" rather than "all zero", since 0 is itself a
	// meaningful explicit value for a couple of these fields (NoDelay/NC).
	KCP *kcpOpts `json:"kcp,omitempty"`

	ConnectHost string `json:"connect_host,omitempty"` // local backend's host, e.g. 127.0.0.1
	ConnectPort int    `json:"connect_port,omitempty"` // required, no default — depends on the local service

	ObfProfile string `json:"obf_profile,omitempty"` // "rtpopus" (default/recommended), "rtpopus2", "rtpopus3", or "none"
	ObfKey     string `json:"obf_key,omitempty"`     // 64 hex chars, required unless ObfProfile is "none"
	ObfTiming  string `json:"obf_timing,omitempty"`  // e.g. "10ms" inter-packet delay for RTP mimicry; only with ObfProfile != "none"

	Port int `json:"port"`
}

// kcpOpts mirrors free-turn-proxy's own "kcp" wire object exactly (its
// internal/uri/uri.go KCP struct / docs/uri.md) — same field names and
// JSON keys — so it can be embedded verbatim in both this package's stored
// CoreConfig and the client-facing freeturnURI without remapping. See
// docs/flags.md's "KCP" table for defaults/ranges.
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

// freeturnURI mirrors the base64url(JSON) payload documented in upstream
// docs/uri.md / docs/sub.md. WireTurn's own parser (AppPreferences.kt's
// FreeTurnConfig.parse) reads "links" via Gson's asString, so this MUST be
// a single comma-joined string, never a JSON array — this field used to be
// []string, which Gson can't coerce, so parse() threw and the *entire* URI
// silently failed to import. See buildURI, which joins
// profileCoreConfig.Links (bare VK Calls ids) into this shape.
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
	// the server process is actually started with (see ensureProcess) — the
	// client needs these to apply the same RTP/Opus obfuscation, or it can't
	// talk to the server at all. Obf is only written when not "none".
	Obf  string `json:"obf,omitempty"`
	Key  string `json:"key,omitempty"`
	Obft string `json:"obft,omitempty"`
}
