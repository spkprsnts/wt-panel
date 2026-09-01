package config

import (
	"os"
	"path/filepath"
)

// Config holds panel-wide settings, loaded from environment variables with sane local-dev defaults.
// Only genuinely panel-wide facts live here (listen address, data dir, public IP, binary paths);
// per-profile properties live in that profile's CoreConfig and are only *defaulted* from here, always
// overridable per profile.
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

	// ListenHost settings are panel-wide (which interface every process of that kernel binds on); the
	// port is still per-profile. olcRTC has no equivalent — it dials out rather than binding a socket.
	TurnableListenHost string
	FreeTurnListenHost string
	WebDAVListenHost   string

	// Per-profile defaults below, used only when a profile's CoreConfig doesn't set the field itself.
	// Only the host has a sane default — the port depends entirely on which local service the
	// operator wants to reach, so it's always required on the profile itself.
	TurnableDefaultRouteHost string // e.g. 127.0.0.1

	FreeTurnDefaultConnectHost string // e.g. 127.0.0.1

	WebDAVDefaultProxyUpstream string // optional "-proxy socks5://..." upstream; empty = direct internet egress

	// OlcRTCDefaultProxyUpstream is olcrtc's outbound SOCKS5 default ("socks5://[user:pass@]host:port"),
	// same reasoning as WebDAVDefaultProxyUpstream — empty = reach the provider directly.
	OlcRTCDefaultProxyUpstream string

	// WebDAVPublicHost overrides the host baked into a selfhosted WebDAV profile's client URI when it
	// should differ from PublicIP — see ResolvedWebDAVPublicHost. WTP_WEBDAV_PUBLIC_HOST only seeds
	// PanelSettings.WebDAVPublicHost on first run; once set, the DB row is authoritative and editable
	// from the Settings page.
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
		// DataDir is also where "install kernel" (internal/kernels) writes binaries by default —
		// TurnableBinPath etc. must resolve to that same file whether written (CWD-relative) or
		// exec'd (PATH-relative for bare names), so the default has to be an unambiguous path.
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
		OlcRTCDefaultProxyUpstream: getEnv("WTP_OLCRTC_DEFAULT_PROXY_UPSTREAM", ""),
	}
	// Deliberately not falling back to cfg.PublicIP here — PublicIP is often still "" at this point
	// (main.go overrides it from PanelSettings right after Load() returns), so baking it in now
	// would freeze WebDAVPublicHost at "" forever. See ResolvedWebDAVPublicHost.
	cfg.WebDAVPublicHost = getEnv("WTP_WEBDAV_PUBLIC_HOST", "")
	_ = os.MkdirAll(cfg.DataDir, 0o755)
	for _, sub := range []string{"turnable", "olcrtc", "webdav", "freeturn", "xray", "bin"} {
		_ = os.MkdirAll(filepath.Join(cfg.DataDir, sub), 0o755)
	}
	return cfg
}

// ResolvedWebDAVPublicHost is WebDAVPublicHost if set, else PublicIP — computed live (not cached at
// Load() time) so it always reflects PublicIP's current value.
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
