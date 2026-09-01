package api

import "encoding/json"

// ProfileBundle mirrors the subscription response schema documented in
// WireTurn's docs/subscriptions.md §5.4.
type ProfileBundle struct {
	Version               int             `json:"version"`
	Name                  string          `json:"name"`
	Description           string          `json:"description,omitempty"`
	Profiles              []BundleProfile `json:"profiles"`
	RecommendedProfileID  string          `json:"recommendedProfileId,omitempty"`
	UpdateIntervalMinutes int             `json:"updateIntervalMinutes,omitempty"`
	BytesUsed             int64           `json:"bytesUsed,omitempty"`
	BytesTotal            int64           `json:"bytesTotal,omitempty"`
}

// BundleProfile mirrors the per-profile Profile JSON schema in WireTurn's docs/subscriptions.md
// §1/§3 — field names/shapes are load-bearing, a real WireTurn client parses exactly this.
// xrayProtocol is "VLESS" or "WIREGUARD"; trojan/hysteria2 links also go through vlessConfig.vlessLink,
// with the app detecting the real protocol from the URI scheme. Only one of VlessConfig/WgConfig is
// ever set, matching XrayProtocol — see buildXrayBundleConfig.
type BundleProfile struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	URI          string       `json:"uri"`
	XrayEnabled  bool         `json:"xrayEnabled,omitempty"`
	XrayProtocol string       `json:"xrayProtocol,omitempty"`
	VlessConfig  *VlessConfig `json:"vlessConfig,omitempty"`
	WgConfig     *WgConfig    `json:"wgConfig,omitempty"`
}

// VlessConfig is WireTurn's §3 vlessConfig. VlessLink holds any vless://, trojan://, hysteria2://,
// or hy2:// client link (app tells them apart by scheme). IsDualRoute/DirectAddress/HcInterval/Mux
// implement "Dual Route": try DirectAddress first (health-checked every HcInterval seconds), fall
// back to tunneling through the kernel if unreachable.
type VlessConfig struct {
	VlessLink     string `json:"vlessLink"`
	IsDualRoute   bool   `json:"isDualRoute,omitempty"`
	DirectAddress string `json:"directAddress,omitempty"`
	HcInterval    string `json:"hcInterval,omitempty"`
	Mux           string `json:"mux,omitempty"`
}

// WgConfig is WireTurn's §3 wgConfig. Endpoint is deliberately left unset — the app always
// overrides it with the local kernel's own address regardless of what's sent.
type WgConfig struct {
	PrivateKey          string `json:"privateKey"`
	PublicKey           string `json:"publicKey"`
	Address             string `json:"address,omitempty"`
	Mtu                 string `json:"mtu,omitempty"`
	PersistentKeepalive string `json:"persistentKeepalive,omitempty"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	// Code is the 6-digit TOTP code, required only once username/password check out and 2FA is
	// enabled (see handleLogin); not `binding:"required"` since a password-only first submission
	// is the normal first half of the two-step flow.
	Code string `json:"code"`
}

type LoginResponse struct {
	Token string `json:"token"`
}

type ClientRequest struct {
	Name             string `json:"name" binding:"required"`
	Enabled          *bool  `json:"enabled"`
	ExpiresAt        *int64 `json:"expiresAt"` // unix seconds, nil = never
	TrafficLimitByte int64  `json:"trafficLimitByte"`

	Description           string `json:"description"`
	UpdateIntervalMinutes int    `json:"updateIntervalMinutes"`
}

type ProfileRequest struct {
	Name       string          `json:"name" binding:"required"`
	CoreType   string          `json:"coreType" binding:"required"`
	CoreConfig json.RawMessage `json:"coreConfig"`
	// Enabled: nil means "leave it on", same *bool-default-true pattern as ClientRequest.Enabled.
	Enabled *bool `json:"enabled"`

	XrayEnabled bool `json:"xrayEnabled"`
	// XrayInboundID picks an already-configured inbound; XrayManualURI/XrayManualWireGuard are the
	// fallback when none is set up yet — mutually exclusive with each other.
	XrayInboundID       *uint  `json:"xrayInboundId"`
	XrayManualURI       string `json:"xrayManualUri"`
	XrayManualWireGuard string `json:"xrayManualWireGuard"`

	// Dual Route (VLESS-mode only — see models.Profile doc comment).
	XrayDualRoute     bool   `json:"xrayDualRoute"`
	XrayDirectAddress string `json:"xrayDirectAddress"`
	XrayHcInterval    string `json:"xrayHcInterval"`
	XrayMux           string `json:"xrayMux"`
}

// ReorderProfilesRequest must list every profile ID belonging to the target
// client, exactly once, in the new desired order — see reorderProfiles.
type ReorderProfilesRequest struct {
	ProfileIDs []uint `json:"profileIds" binding:"required"`
}

// SetRecommendedRequest — see setProfileRecommended.
type SetRecommendedRequest struct {
	Recommended bool `json:"recommended"`
}
