package webdav

// profileCoreConfig is what we store (as JSON) in models.Profile.CoreConfig
// for CoreWebDAV profiles.
//
// ConnMode picks the server-side mode: "selfhosted" (default; empty also
// means this, for profiles predating the field) runs the embedded WebDAV,
// "server" relays to existing external backends (Backends).
//
// Login/Password/Port are infra, selfhosted-only: minted once in AddProfile,
// never re-minted afterwards. TLSCertFile/TLSKeyFile point webdav-tunnel's
// built-in TLS directly at a cert/key pair — no reverse proxy. Enc turns on
// AES-256-GCM chunk encryption, signaled to the client via the "enc=1" query param.
type profileCoreConfig struct {
	ConnMode string `json:"conn_mode,omitempty"` // "selfhosted" (default) or "server"

	Login         string `json:"login"`
	Password      string `json:"password"`
	Port          int    `json:"port"`
	ProxyUpstream string `json:"proxy_upstream,omitempty"`
	Enc           bool   `json:"enc,omitempty"`
	TLSCertFile   string `json:"tls_cert_file,omitempty"`
	TLSKeyFile    string `json:"tls_key_file,omitempty"`
	// Dns is the DNS server (host:port) webdav-tunnel uses to resolve its
	// own WebDAV backend's hostname (-dns) — irrelevant to SOCKS5-tunneled traffic.
	Dns string `json:"dns,omitempty"`

	// Backends is server-mode-only: existing external WebDAV endpoints to
	// relay through; more than one enables round-robin rotation. Written
	// into a generated YAML file (-config), since -webdav/-login/-password only describe one backend.
	Backends []WebdavBackend `json:"backends,omitempty"`

	// Tuning overrides — empty/zero means let webdav-tunnel apply its own
	// default: selfhosted auto-applies a faster poll-min/poll-max/coalesce
	// preset, server mode uses the generic defaults. The UI's quick-fill presets are just these same numbers, not a stored mode.
	PollMin   string `json:"poll_min,omitempty"`
	PollMax   string `json:"poll_max,omitempty"`
	Coalesce  string `json:"coalesce,omitempty"`
	ChunkSize int    `json:"chunk_size,omitempty"`
	Puts      int    `json:"puts,omitempty"`
	ReadMin   int    `json:"read_min,omitempty"`
	ReadMax   int    `json:"read_max,omitempty"`
}

// WebdavBackend is one external WebDAV endpoint for server-mode rotation.
// Both json and yaml tags point at the same struct, so there's one definition instead of two that could drift.
type WebdavBackend struct {
	URL      string `json:"url" yaml:"url"`
	Login    string `json:"login" yaml:"login"`
	Password string `json:"password" yaml:"password"`
}
