package freeturn

// profileCoreConfig is what we store (as JSON) in models.Profile.CoreConfig
// for CoreFreeTurn profiles.
//
// Port is infra: allocated once in AddProfile/Restore and never re-minted
// by UpdateProfile, since the client's freeturn:// URI already has it baked
// in as "peer". ObfKey is also infra by the same logic as olcRTC's
// crypto.key — generated once (or supplied by the operator) and kept
// stable, since rotating it would break every client using this profile.
//
// Provider/Links/Transport are logical — they only affect the JSON payload
// handed to the client, never the server process's own flags, so editing
// them never needs a restart at all. ConnectHost/ConnectPort/ObfProfile/
// ObfTiming ARE logical but DO affect the process's own flags, so changing
// them needs a restart.
//
// There is deliberately no clients.json / Client ID allowlist here: with
// one dedicated process per profile, access is already scoped by the
// (secret) obf-key and port — see docs/flags.md "клиент всегда отправляет
// свой Client ID... сервер его читает" only when -clients-file is set, and
// we choose not to set it, same as the plain systemd/Docker examples in
// docs/deploy.md which only pass -obf-profile/-obf-key.
//
// VK Calls ids are the caller's responsibility to supply (they're
// single-use meeting ids, not something the panel can mint on its own) —
// the panel just stores and re-embeds them. Despite the field's name, this
// holds bare call ids (e.g. "ABC123xyz..."), the same thing Turnable's
// call_id takes — not full https://vk.com/call/join/... links.
type profileCoreConfig struct {
	Provider  string   `json:"provider"`  // "vk"
	Links     []string `json:"links"`     // VK Calls ids, per docs/providers.md
	Transport string   `json:"transport"` // "tcp" or "udp", must match server -obf-profile expectations

	ConnectHost string `json:"connect_host,omitempty"` // local backend's host, e.g. 127.0.0.1
	ConnectPort int    `json:"connect_port,omitempty"` // required, no default — depends on the local service

	ObfProfile string `json:"obf_profile,omitempty"` // "rtpopus" (default/recommended), "rtpopus2", "rtpopus3", or "none"
	ObfKey     string `json:"obf_key,omitempty"`      // 64 hex chars, required unless ObfProfile is "none"
	ObfTiming  string `json:"obf_timing,omitempty"`   // e.g. "10ms" inter-packet delay for RTP mimicry; only with ObfProfile != "none"

	Port int `json:"port"`
}

// freeturnURI mirrors the base64url(JSON) payload documented in
// upstream docs/uri.md / docs/sub.md.
type freeturnURI struct {
	V         int      `json:"v"`
	Provider  string   `json:"provider"`
	Peer      string   `json:"peer"` // host:port of this profile's dedicated freeturn server process
	Links     []string `json:"links"` // bare VK Calls ids — see profileCoreConfig.Links above
	Sub       string   `json:"sub,omitempty"`
	Transport string   `json:"transport"`
	Mode      string   `json:"mode"`

	// Obf/Key/Obft must mirror the -obf-profile/-obf-key/-obf-timing flags
	// the server process is actually started with (see ensureProcess) — the
	// client needs these to apply the same RTP/Opus obfuscation the server
	// expects, otherwise it can't talk to it at all. Obf is only written
	// when not "none", matching upstream docs/uri.md.
	Obf  string `json:"obf,omitempty"`
	Key  string `json:"key,omitempty"`
	Obft string `json:"obft,omitempty"`
}
