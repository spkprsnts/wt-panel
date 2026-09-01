package models

import (
	"time"

	"gorm.io/gorm"
)

// CoreType is one of the four WireTurn tunnel kernels.
type CoreType string

const (
	CoreTurnable CoreType = "turnable"
	CoreOlcRTC   CoreType = "olcrtc"
	CoreWebDAV   CoreType = "webdav"
	CoreFreeTurn CoreType = "freeturn"
	// CoreXray is used only for KernelInstall bookkeeping — never a valid Profile.CoreType. Xray-core
	// is a single shared process serving every enabled XrayInbound (see internal/xray), not a
	// per-profile kernel like the four above.
	CoreXray CoreType = "xray"
)

// AdminUser is a panel operator account (not a VPN client).
type AdminUser struct {
	gorm.Model
	Username     string `gorm:"uniqueIndex;not null"`
	PasswordHash string `gorm:"not null"`
	// TOTPSecret is the base32 RFC 6238 secret for this admin's optional 2FA; empty means 2FA is off.
	// Only ever set via confirmTotpSetup, which requires a real passing code first, so a mis-scanned
	// QR code can't lock the admin out of their own account.
	TOTPSecret string
}

// Client is an end user of the VPN service.
type Client struct {
	gorm.Model
	Name string `gorm:"not null"`
	// No gorm "default:true" tag: GORM can't distinguish explicit false from unset for a plain bool,
	// so the tag would silently omit false from the INSERT and let the DB DEFAULT revert it to true.
	Enabled          bool
	ExpiresAt        *time.Time
	TrafficLimitByte int64 // 0 = unlimited
	TrafficUsedByte  int64

	// Description and UpdateIntervalMinutes are subscription-level metadata (§5.4's
	// ProfileBundle.description/updateIntervalMinutes, §5.5's "#description:"/"#refresh:" tags) —
	// purely informational, never fed back into provisioning.
	Description           string `gorm:"type:text"`
	UpdateIntervalMinutes int    `gorm:"default:60"`

	Profiles           []Profile
	SubscriptionTokens []SubscriptionToken
	// XrayClients are this Client's per-inbound identities (UUID/password/WG keypair) — see
	// XrayClient. A has-many off the real Client row so deleting a Client cascades here.
	XrayClients []XrayClient
}

// Profile is a single kernel entry point (+ optional xray/wg overlay)
// belonging to a Client. ExternalID is the stable id sent to WireTurn
// clients in the ProfileBundle (matched across subscription refreshes).
type Profile struct {
	gorm.Model
	ClientID   uint     `gorm:"index;not null"`
	ExternalID string   `gorm:"uniqueIndex;not null"` // stable "id" field per WireTurn spec
	Name       string   `gorm:"not null"`
	CoreType   CoreType `gorm:"not null"`
	// SortOrder is this profile's position within its client's list (0 = first), also the
	// RecommendedProfileID fallback when none is explicitly Recommended. "default:0" is required
	// for SQLite to add this NOT NULL column to an existing table.
	SortOrder int `gorm:"not null;index;default:0"`

	// Recommended flags this client's preferred profile (at most one; set via setProfileRecommended,
	// which clears any sibling), falling back to SortOrder's first when unset. Needs the same
	// not-null-default tag as SortOrder — without it, existing rows migrate in as SQL NULL.
	Recommended bool `gorm:"not null;default:false"`

	// CoreConfig holds core-specific provisioning data as JSON, shape depends on CoreType (see
	// provisioner packages).
	CoreConfig string `gorm:"type:text"`
	// KernelURI is the turnable://, olcrtc://, webdavs:// or freeturn:// URI from Provisioner.AddProfile,
	// cached so the subscription endpoint doesn't re-provision on every read.
	KernelURI string `gorm:"type:text"`

	// Enabled controls whether this profile's kernel process should be running — lets an operator
	// stage a profile without starting it, or take one offline without losing its provisioned state
	// (port, keys). Unlike XrayInbound.Enable, this has a real live effect: see Provisioner.Stop and
	// RestoreAll's Enabled check. No gorm "default:true" tag — that would silently revert an explicit
	// false back to true on Create (GORM omits a false bool from the INSERT, letting the DB DEFAULT win).
	Enabled bool

	XrayEnabled bool
	// XrayInboundID is the picked, already-configured inbound this profile's overlay tunnels through
	// — the primary UI path. Nil while XrayManualURI/XrayManualWireGuard is used instead.
	XrayInboundID *uint `gorm:"index"`
	XrayInbound   *XrayInbound
	// XrayManualURI is a pasted ready-made vless://, trojan://, hysteria2:// URI when no matching
	// inbound is set up yet — mutually exclusive with XrayManualWireGuard.
	XrayManualURI string `gorm:"type:text"`
	// XrayManualWireGuard is a pasted [Interface]/[Peer]-style WireGuard config, the manual fallback
	// for that protocol — its own field since a WG config isn't a single URI.
	XrayManualWireGuard string `gorm:"type:text"`

	// XrayDualRoute and friends are WireTurn's vlessConfig "Dual Route" fields (§3): the app tries
	// XrayDirectAddress first (health-checked every XrayHcInterval seconds), falling back to the
	// kernel tunnel on failure. VLESS-mode only — WireGuard has no equivalent in the spec.
	XrayDualRoute     bool   `gorm:"default:false"`
	XrayDirectAddress string `gorm:"type:text"`
	XrayHcInterval    string // seconds, spec default "30"
	XrayMux           string // stream count, spec default "0" (disabled)

	// Running/PID are not persisted — they reflect the live state of this
	// profile's supervised OS process at request time (see
	// Provisioner.Status) and are filled in by the API handlers before
	// serializing a Profile in a response.
	Running bool `json:"Running" gorm:"-"`
	PID     int  `json:"PID,omitempty" gorm:"-"`
}

// SubscriptionToken maps an opaque token to a Client's ProfileBundle.
type SubscriptionToken struct {
	gorm.Model
	ClientID       uint   `gorm:"index;not null"`
	Token          string `gorm:"uniqueIndex;not null"`
	LastAccessedAt *time.Time
}

// CallRoom is a saved call/room identifier for platforms that need one created out-of-band (VK
// Calls, WB Stream, Telemost, Jitsi), so the operator doesn't re-find a room for every new profile.
// Valid/LastCheckedAt are placeholders for a future "check this room is still alive" feature.
type CallRoom struct {
	gorm.Model
	Provider      string `gorm:"not null;index"` // "vk", "wbstream", "telemost", "jitsi"
	RoomID        string `gorm:"not null"`       // call_id (vk), room id (wbstream/telemost), or full URL (jitsi)
	Label         string
	Notes         string
	LastCheckedAt *time.Time
	Valid         *bool
}

// XrayInbound is a stored Xray-core inbound config (VLESS/Trojan/Hysteria2/WireGuard) — the overlay
// protocol profiles tunnel through a kernel. The column split (Settings/StreamSettings/Sniffing as
// JSON blobs, Port/Listen/Remark/Enable as real columns) mirrors 3x-ui's schema so a real xray-core
// process can assemble config.json by concatenating these almost as-is; Port is a real column so
// other parts of the panel can read it without parsing per-protocol JSON. Turned into a real process
// by internal/xray.Manager (see reloadXray).
type XrayInbound struct {
	gorm.Model
	Protocol string `gorm:"not null"` // "vless", "trojan", "hysteria2", "wireguard"
	Remark   string `gorm:"not null"` // display name (3x-ui calls this "Remark")
	Listen   string // empty = all interfaces
	Port     int    `gorm:"not null"`
	// No gorm "default:true" tag — see Profile.Enabled's doc comment for why
	// that silently reverts an explicit false back to true on Create.
	Enable bool

	// Settings holds protocol-specific, inbound-level fields that aren't per-client (vless:
	// decryption/fallbacks; trojan: fallbacks; hysteria2: obfs/upMbps/downMbps; wireguard: server
	// secretKey/address/mtu). Per-client identity lives in XrayClient, not inline like raw xray-core config.
	Settings string `gorm:"type:text"`
	// StreamSettings is network+security+TLS/Reality — only meaningful for vless/trojan.
	StreamSettings string `gorm:"type:text"`
	Sniffing       string `gorm:"type:text"`

	// foreignKey is explicit because the column is named InboundID, not the
	// XrayInboundID GORM would otherwise guess from this field's name.
	Clients []XrayClient `gorm:"foreignKey:InboundID"`
}

// XrayClient attaches one panel Client to one XrayInbound, holding the per-user identity xray-core
// multiplexes on that inbound's socket: {uuid,flow,email} for vless, {password,email} for
// trojan/hysteria2, {privateKey,publicKey,address} for wireguard. Keyed off an existing Client row
// (deleting a Client cascades here), one row per (InboundID, ClientID) pair.
type XrayClient struct {
	gorm.Model
	InboundID uint   `gorm:"index;not null;uniqueIndex:idx_xray_inbound_client"`
	ClientID  uint   `gorm:"index;not null;uniqueIndex:idx_xray_inbound_client"`
	Config    string `gorm:"type:text"` // JSON, shape depends on the inbound's Protocol
	// No gorm "default:true" tag — see Profile.Enabled's doc comment for why
	// that silently reverts an explicit false back to true on Create.
	Enable bool
}

// PanelSettings is the panel's own network/TLS configuration — editable via the Settings page,
// mirroring 3x-ui's "Panel Settings" tab. Singleton row (ID always 1, seeded at startup — see
// db.go). main.go reads this once at startup to build the http.Server, so a change here only takes
// effect after a restart — no in-process hot-rebind.
type PanelSettings struct {
	gorm.Model
	ListenIP     string // empty = all interfaces
	ListenDomain string // empty = any Host header accepted
	ListenPort   int    // 0 = use the WTP_LISTEN_ADDR/default port
	BasePath     string `gorm:"default:/"` // must start and end with '/'
	TLSCertFile  string
	TLSKeyFile   string
	// PublicIP is the VPS's own public IP/hostname, baked into every profile's client-facing config.
	// Auto-detected and pre-filled on first run (see db.seedPanelSettings) since a missing value is
	// exactly what produces Turnable's "public_ip is required" failure, but auto-detection can guess
	// wrong (multi-homed box, NAT/CDN, IPv6-only egress), so it's a plain editable field.
	PublicIP string
	// WebDAVPublicHost overrides the host baked into a selfhosted WebDAV profile's client URI when it
	// should differ from PublicIP (e.g. the panel's TLS cert is issued for a domain, or WebDAV uses a
	// separate DNS record). Empty means "same as PublicIP" — see config.Config.ResolvedWebDAVPublicHost.
	WebDAVPublicHost string
}

// KernelInstall records the currently installed binary for one kernel, one row per CoreType. All
// but olcRTC install from a GitHub release (Version = release tag); olcRTC has no upstream releases,
// so it's built from source at a chosen commit (Version = commit SHA, Source = "build").
type KernelInstall struct {
	gorm.Model
	CoreType    CoreType `gorm:"uniqueIndex;not null"`
	Version     string   `gorm:"not null"` // release tag or commit SHA
	Source      string   `gorm:"not null"` // "release" or "build"
	InstalledAt time.Time
	BuildLog    string `gorm:"type:text"` // only meaningful for Source == "build"
}
