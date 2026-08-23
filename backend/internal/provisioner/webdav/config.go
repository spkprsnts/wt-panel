package webdav

// profileCoreConfig is what we store (as JSON) in models.Profile.CoreConfig
// for CoreWebDAV profiles.
//
// ConnMode picks which of webdav-tunnel's two server-side modes this
// profile runs: "selfhosted" (default, empty also means this — older
// profiles predate this field) runs the embedded WebDAV, "server" connects
// out to one or more already-existing external WebDAV backends (Backends)
// instead of hosting one itself.
//
// Login/Password/Port are infra, selfhosted-only: filled in on first
// AddProfile call if left empty and never re-minted afterwards — webdav-
// tunnel selfhosted has no multi-user concept, so every profile gets its
// own process + port + creds. ProxyUpstream is logical: falls back to
// config.WebDAVDefaultProxyUpstream when empty, but a profile can route
// through a different upstream SOCKS5 than the rest.
//
// TLSCertFile/TLSKeyFile (selfhosted-only) point webdav-tunnel's own
// built-in TLS support (-webdav-tls-cert/-webdav-tls-key) directly at a
// cert/key pair already on this host's filesystem — no reverse proxy in
// front. Enc turns on webdav-tunnel's AES-256-GCM chunk encryption; the
// client learns about it from the "enc=1" query param this provisioner's
// buildURI adds, never a separate side channel, so a client using the
// generated URI always matches what the server actually does.
type profileCoreConfig struct {
	ConnMode string `json:"conn_mode,omitempty"` // "selfhosted" (default) or "server"

	Login         string `json:"login"`
	Password      string `json:"password"`
	Port          int    `json:"port"`
	ProxyUpstream string `json:"proxy_upstream,omitempty"`
	Enc           bool   `json:"enc,omitempty"`
	TLSCertFile   string `json:"tls_cert_file,omitempty"`
	TLSKeyFile    string `json:"tls_key_file,omitempty"`
	// Dns is the DNS server (host:port) webdav-tunnel uses to resolve only
	// its own WebDAV backend's hostname (-dns) — irrelevant to SOCKS5-
	// tunneled traffic, which always resolves server-side.
	Dns string `json:"dns,omitempty"`

	// Backends is server-mode-only: one or more already-existing external
	// WebDAV endpoints to relay through — see docs/config.md#multi-backend-
	// rotation upstream. A single entry is a plain external-WebDAV setup;
	// more than one enables webdav-tunnel's own round-robin rotation across
	// them. Written into a generated YAML file (-config) rather than CLI
	// flags, since -webdav/-login/-password only ever describe one backend.
	Backends []WebdavBackend `json:"backends,omitempty"`

	// Tuning overrides (docs/tuning.md upstream) — every field empty/zero
	// means "let webdav-tunnel apply its own default for this mode" rather
	// than a real value: selfhosted auto-applies a faster preset for
	// poll-min/poll-max/coalesce (its own local WebDAV can take it), server
	// mode always uses the plain generic defaults unless told otherwise
	// (external storage's real network conditions vary too much to guess).
	// See resolveTuning, which is also where the panel's own "fast
	// (self-hosted)"/"standard (external)" quick-fill presets in the UI
	// ultimately come from — they're just these same two numbers offered as
	// a one-click fill-in, not a stored mode of their own.
	PollMin   string `json:"poll_min,omitempty"`
	PollMax   string `json:"poll_max,omitempty"`
	Coalesce  string `json:"coalesce,omitempty"`
	ChunkSize int    `json:"chunk_size,omitempty"`
	Puts      int    `json:"puts,omitempty"`
	ReadMin   int    `json:"read_min,omitempty"`
	ReadMax   int    `json:"read_max,omitempty"`
}

// WebdavBackend is one external WebDAV endpoint for server-mode rotation.
// Both json (CoreConfig persistence) and yaml (the generated webdav-tunnel
// -config file) tags point at the same struct so there's exactly one
// definition of "what a backend is" instead of two that could drift apart.
type WebdavBackend struct {
	URL      string `json:"url" yaml:"url"`
	Login    string `json:"login" yaml:"login"`
	Password string `json:"password" yaml:"password"`
}
