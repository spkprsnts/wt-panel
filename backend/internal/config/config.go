package config

import (
	"os"
	"path/filepath"
)

// Config holds panel-wide settings, loaded from environment variables
// with sane local-dev defaults.
//
// Only genuinely panel-wide facts live here: where to listen, where the
// data dir is, the VPS's public IP, binary paths. Anything that's really a
// property of one profile (platform, call/room id, egress destination,
// upstream proxy) lives in that profile's CoreConfig — see the provisioner
// packages — and is only *defaulted* from here so the create-profile form
// doesn't have to be filled in every time. A profile can always override
// the default by setting the field explicitly in its coreConfig.
type Config struct {
	ListenAddr   string
	DBPath       string
	JWTSecret    string
	DataDir      string // base dir for rendered backend configs (turnable/olcrtc/webdav/freeturn)
	PublicOrigin string // e.g. https://panel.example.com, used to build subscription URLs
	PublicIP     string // VPS public IP/hostname, shared by all kernels' client URIs

	TurnableBinPath string
	OlcRTCBinPath   string
	WebDAVBinPath   string
	FreeTurnBinPath string
	XrayBinPath     string

	// ListenHost settings are true panel-wide settings (which interface
	// every process of that kernel binds on) — the port is still allocated
	// per profile. olcRTC has no equivalent: in "mode: srv" it dials out to
	// the platform/room rather than binding a local listening socket.
	TurnableListenHost string
	FreeTurnListenHost string
	WebDAVListenHost   string

	// Per-profile default below: used only when a profile's CoreConfig
	// doesn't set the field itself. Turnable's pub_key/priv_key are NOT
	// here — they're generated fresh per profile via 'turnable config
	// keygen' (see provisioner/turnable), since there's no reason for two
	// independent profile processes to share key material. PlatformID and
	// RouteSocket used to be configurable the same way, but the form
	// (profile-form.tsx) always sends an explicit value for both — a
	// single-option "vk.com" platform select, "udp" as the route socket's
	// own initial state — so an env-var default could only ever matter for
	// a profile created by calling the API directly, bypassing the panel
	// UI entirely; not a supported path, so provisioner/turnable now just
	// hardcodes both instead. TurnableDefaultRouteHost is just the host
	// part — there's no sensible default port (it depends entirely on
	// which local service, WireGuard vs VLESS vs something else, the
	// operator wants this profile to reach), so the route's port is always
	// required on the profile itself.
	TurnableDefaultRouteHost string // e.g. 127.0.0.1

	// Same reasoning as Turnable's route: only the host has a sane default.
	FreeTurnDefaultConnectHost string // e.g. 127.0.0.1

	WebDAVDefaultProxyUpstream string // optional "-proxy socks5://..." upstream; empty = direct internet egress

	// WebDAVPublicHost overrides the host address baked into a selfhosted
	// WebDAV profile's client URI when it should differ from PublicIP (a
	// custom domain, say) — see ResolvedWebDAVPublicHost. Same two-tier
	// pattern as PublicIP itself: WTP_WEBDAV_PUBLIC_HOST only seeds
	// PanelSettings.WebDAVPublicHost on first run (db.seedPanelSettings);
	// once that DB row has a value, main.go's own override of this field at
	// startup makes it authoritative, and it's editable from then on via the
	// Settings page like PublicIP is. The scheme (webdav/webdavs) has no
	// panel-wide equivalent: each profile derives it from whether it has its
	// own TLS cert/key configured (see provisioner/webdav's
	// buildSelfhostedURI) — there's no reverse-proxy TLS-termination
	// deployment model here to have a global default for.
	WebDAVPublicHost string
}

func Load() *Config {
	dataDir := getEnv("WTP_DATA_DIR", "data")
	defaultBinPath := func(name string) string {
		return filepath.Join(dataDir, "bin", name)
	}

	cfg := &Config{
		ListenAddr: getEnv("WTP_LISTEN_ADDR", ":8090"),
		DBPath:     getEnv("WTP_DB_PATH", "wtpanel.db"),
		JWTSecret:  getEnv("WTP_JWT_SECRET", "dev-insecure-secret-change-me"),
		// DataDir is also where the "install kernel" feature (see
		// internal/kernels) writes downloaded/built binaries by default —
		// TurnableBinPath etc. below MUST resolve to that same file both
		// when we write it (os.WriteFile, CWD-relative) and when we exec it
		// (os/exec, PATH-relative for bare names), so the default can't be
		// a bare command name — it has to be an unambiguous path.
		DataDir:         dataDir,
		PublicOrigin:    getEnv("WTP_PUBLIC_ORIGIN", "http://localhost:8090"),
		PublicIP:        getEnv("WTP_PUBLIC_IP", ""),
		TurnableBinPath: getEnv("WTP_TURNABLE_BIN", defaultBinPath("turnable")),
		OlcRTCBinPath:   getEnv("WTP_OLCRTC_BIN", defaultBinPath("olcrtc")),
		WebDAVBinPath:   getEnv("WTP_WEBDAV_BIN", defaultBinPath("webdav-tunnel")),
		FreeTurnBinPath: getEnv("WTP_FREETURN_BIN", defaultBinPath("freeturn-server")),
		XrayBinPath:     getEnv("WTP_XRAY_BIN", defaultBinPath("xray")),

		TurnableListenHost: getEnv("WTP_TURNABLE_LISTEN_HOST", "0.0.0.0"),
		FreeTurnListenHost: getEnv("WTP_FREETURN_LISTEN_HOST", "0.0.0.0"),
		WebDAVListenHost:   getEnv("WTP_WEBDAV_LISTEN_HOST", "0.0.0.0"),

		TurnableDefaultRouteHost: getEnv("WTP_TURNABLE_DEFAULT_ROUTE_HOST", "127.0.0.1"),

		FreeTurnDefaultConnectHost: getEnv("WTP_FREETURN_DEFAULT_CONNECT_HOST", "127.0.0.1"),

		WebDAVDefaultProxyUpstream: getEnv("WTP_WEBDAV_DEFAULT_PROXY_UPSTREAM", ""),
	}
	// Deliberately NOT falling back to cfg.PublicIP here — at this point in
	// startup PublicIP is often still "" (main.go overrides it from
	// PanelSettings, auto-detected or Settings-page-edited, right after
	// Load() returns). Baking that in here would freeze WebDAVPublicHost at
	// "" forever even once PublicIP is populated. See ResolvedWebDAVPublicHost.
	cfg.WebDAVPublicHost = getEnv("WTP_WEBDAV_PUBLIC_HOST", "")
	_ = os.MkdirAll(cfg.DataDir, 0o755)
	for _, sub := range []string{"turnable", "olcrtc", "webdav", "freeturn", "xray", "bin"} {
		_ = os.MkdirAll(filepath.Join(cfg.DataDir, sub), 0o755)
	}
	return cfg
}

// ResolvedWebDAVPublicHost is WebDAVPublicHost if the operator explicitly
// set one, else PublicIP — computed live (not cached at Load() time) so it
// always reflects PublicIP's current value, however that got set (env var,
// auto-detection, or the Settings page).
func (cfg *Config) ResolvedWebDAVPublicHost() string {
	if cfg.WebDAVPublicHost != "" {
		return cfg.WebDAVPublicHost
	}
	return cfg.PublicIP
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
