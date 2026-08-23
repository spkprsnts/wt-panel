package webdav

// profileCoreConfig is what we store (as JSON) in models.Profile.CoreConfig
// for CoreWebDAV profiles. Login/Password/Port are infra: filled in on first
// AddProfile call if left empty and never re-minted afterwards — webdav-
// tunnel selfhosted has no multi-user concept, so every profile gets its
// own process + port + creds. ProxyUpstream is logical: falls back to
// config.WebDAVDefaultProxyUpstream when empty, but a profile can route
// through a different upstream SOCKS5 than the rest.
type profileCoreConfig struct {
	Login         string `json:"login"`
	Password      string `json:"password"`
	Port          int    `json:"port"`
	ProxyUpstream string `json:"proxy_upstream,omitempty"`
}
