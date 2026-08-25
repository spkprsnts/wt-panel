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
	// CoreXray is used only for KernelInstall bookkeeping (the "Ядра" page's
	// install/version tracking) — never a valid Profile.CoreType. Xray-core
	// isn't a per-profile kernel like the four above; it's a single shared
	// process serving every enabled XrayInbound at once (see internal/xray).
	CoreXray CoreType = "xray"
)

// AdminUser is a panel operator account (not a VPN client).
type AdminUser struct {
	gorm.Model
	Username     string `gorm:"uniqueIndex;not null"`
	PasswordHash string `gorm:"not null"`
	// TOTPSecret is the base32 RFC 6238 secret for this admin's optional
	// 2FA — empty means 2FA is off, same "presence is the flag" convention
	// as ListenDomain/WebDAVPublicHost elsewhere in this file. Only ever
	// set via confirmTotpSetup, which requires a real passing code first —
	// never straight from the setup step — so a mis-scanned QR code or a
	// typo can't lock the admin out of their own account.
	TOTPSecret string
}

// Client is an end user of the VPN service.
type Client struct {
	gorm.Model
	Name string `gorm:"not null"`
	// No gorm "default:true" tag: GORM can't distinguish an explicit false
	// from "unset" for a plain bool (false is also its Go zero value), so a
	// default tag makes it silently omit Enabled from the INSERT whenever a
	// caller sets it to false, letting the DB's DEFAULT overwrite it back to
	// true — the application layer already fully controls this default (see
	// createClient), so the DB-level one only caused data loss.
	Enabled          bool
	ExpiresAt        *time.Time
	TrafficLimitByte int64 // 0 = unlimited
	TrafficUsedByte  int64

	// Description and UpdateIntervalMinutes are subscription-level metadata
	// (docs/subscriptions.md §5.4's ProfileBundle.description/
	// updateIntervalMinutes, and §5.5's "#description:"/"#refresh:" text-sub
	// tags) — purely informational/client-polling-cadence, never fed back
	// into provisioning.
	Description           string `gorm:"type:text"`
	UpdateIntervalMinutes int    `gorm:"default:60"`

	Profiles           []Profile
	SubscriptionTokens []SubscriptionToken
	// XrayClients are this Client's per-inbound identities (UUID/password/
	// WG keypair) — see XrayClient. Deliberately a has-many off the real
	// Client row: an Xray identity can never exist for a client that isn't
	// on the Clients page, and deleting a Client cascades here.
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

	// CoreConfig holds the core-specific provisioning data as JSON,
	// shape depends on CoreType (see provisioner packages for the structs).
	CoreConfig string `gorm:"type:text"`
	// KernelURI is the turnable://, olcrtc://, webdavs:// or freeturn://
	// URI produced by the matching Provisioner.AddProfile call, cached here
	// so the subscription endpoint doesn't need to re-provision on every read.
	KernelURI string `gorm:"type:text"`

	// Enabled controls whether this profile's kernel process should be
	// running at all — lets an operator create/edit a profile without its
	// process ever actually coming up (e.g. staging it ahead of time), and
	// take an existing one offline without losing its provisioned state
	// (port, keys) or deleting the row, mirroring XrayInbound.Enable.
	// Unlike XrayInbound.Enable, this has a real live effect: see
	// Provisioner.Stop and RestoreAll's own Enabled check.
	//
	// No gorm "default:true" tag: GORM can't distinguish an explicit false
	// from "unset" for a plain bool (false is also its Go zero value), so a
	// default tag makes it silently omit Enabled from the INSERT whenever a
	// caller sets it to false, letting the DB's DEFAULT overwrite it back to
	// true right after — confirmed live: creating a profile disabled came
	// back Enabled:true and running. createProfile already fully controls
	// this default in Go, so the DB-level one only caused data loss.
	Enabled bool

	XrayEnabled bool
	// XrayInboundID is the picked, already-configured inbound this profile's
	// overlay tunnels through — the primary path in the UI. Nil while
	// XrayManualURI or XrayManualWireGuard is used instead. The protocol
	// served is always XrayInbound.Protocol — Profile doesn't duplicate it.
	XrayInboundID *uint `gorm:"index"`
	XrayInbound   *XrayInbound
	// XrayManualURI is a pasted ready-made vless://, trojan://, hysteria2://
	// URI when no matching inbound is set up yet — mutually exclusive with
	// XrayManualWireGuard below (only one manual fallback is active per
	// profile at a time; the UI clears whichever isn't selected).
	XrayManualURI string `gorm:"type:text"`
	// XrayManualWireGuard is a pasted [Interface]/[Peer]-style WireGuard
	// config, the manual fallback for that protocol specifically — a WG
	// config isn't a single URI, so it needed its own field rather than
	// overloading XrayManualURI with two different shapes of opaque text.
	XrayManualWireGuard string `gorm:"type:text"`

	// XrayDualRoute and friends are WireTurn's vlessConfig "Dual Route"
	// fields (docs/subscriptions.md §3): the app tries connecting straight
	// to XrayDirectAddress first, health-checking it every XrayHcInterval
	// seconds, and falls back to tunneling through the kernel only if that
	// direct path fails. Only meaningful when the overlay is in VLESS mode
	// (vless/trojan/hysteria2 — an inbound of one of those protocols, or
	// XrayManualURI) — WireGuard mode has no equivalent in the spec.
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

// CallRoom is a saved call/room identifier for the platforms that need one
// created out-of-band (VK Calls, WB Stream, Telemost, Jitsi) — a journal so
// the operator doesn't have to go re-create/re-find a room every time they
// wire up a new Turnable/FreeTurn (call_id) or olcRTC (room_id) profile.
// Valid/LastCheckedAt are placeholders for a future "check this room is
// still alive" feature — nil means never checked, not "checked and failed".
type CallRoom struct {
	gorm.Model
	Provider      string `gorm:"not null;index"` // "vk", "wbstream", "telemost", "jitsi"
	RoomID        string `gorm:"not null"`       // call_id (vk), room id (wbstream/telemost), or full URL (jitsi)
	Label         string
	Notes         string
	LastCheckedAt *time.Time
	Valid         *bool
}

// XrayInbound is a stored Xray-core inbound config (VLESS/Trojan/
// Hysteria2/WireGuard) — the overlay protocol profiles tunnel through a
// kernel. Column split (Settings/StreamSettings/Sniffing as separate JSON
// blobs, Port/Listen/Remark/Enable as real columns) deliberately mirrors
// 3x-ui's own inbound schema, so a future real xray-core process can
// assemble the final config.json by concatenating these almost as-is.
// Port is a real column rather than buried in Settings JSON because other
// parts of the panel (profile route/-connect auto-fill) need to read it
// without parsing per-protocol JSON.
//
// This is deliberately just a config record for now: no xray-core process
// is actually run or reconfigured from it yet (see README "Статус
// реализации" for the planned follow-up), same pattern as everything else
// here started as a config record before the matching process-management
// code existed.
type XrayInbound struct {
	gorm.Model
	Protocol string `gorm:"not null"` // "vless", "trojan", "hysteria2", "wireguard"
	Remark   string `gorm:"not null"` // display name (3x-ui calls this "Remark")
	Listen   string // empty = all interfaces
	Port     int    `gorm:"not null"`
	// No gorm "default:true" tag — see Profile.Enabled's doc comment for why
	// that silently reverts an explicit false back to true on Create.
	Enable bool

	// Settings holds the protocol-specific, inbound-level fields that
	// aren't per-client (vless: decryption/fallbacks; trojan: fallbacks;
	// hysteria2: obfs/upMbps/downMbps; wireguard: server secretKey/address/
	// mtu). Per-client identity lives in XrayClient, not here — unlike raw
	// xray-core config where a vless/trojan inbound's Settings.clients is
	// inline, this panel keeps client identity tied to the real Client row.
	Settings string `gorm:"type:text"`
	// StreamSettings is network+security+TLS/Reality — only meaningful for
	// vless/trojan (hysteria2 and wireguard don't have a streamSettings
	// layer in xray-core).
	StreamSettings string `gorm:"type:text"`
	Sniffing       string `gorm:"type:text"`

	// foreignKey is explicit because the column is named InboundID, not the
	// XrayInboundID GORM would otherwise guess from this field's name.
	Clients []XrayClient `gorm:"foreignKey:InboundID"`
}

// XrayClient attaches one panel Client to one XrayInbound, holding the
// actual per-user identity xray-core would multiplex on that inbound's
// single listening socket: {uuid,flow,email} for vless, {password,email}
// for trojan/hysteria2, {privateKey,publicKey,address} for wireguard.
// Deliberately keyed off an existing Client row rather than being its own
// free-standing identity — an inbound never has a client that doesn't
// exist on the Clients page, and deleting a Client cascades here. One row
// per (InboundID, ClientID) pair; a client can be attached to several
// inbounds, but only once to each.
type XrayClient struct {
	gorm.Model
	InboundID uint   `gorm:"index;not null;uniqueIndex:idx_xray_inbound_client"`
	ClientID  uint   `gorm:"index;not null;uniqueIndex:idx_xray_inbound_client"`
	Config    string `gorm:"type:text"` // JSON, shape depends on the inbound's Protocol
	// No gorm "default:true" tag — see Profile.Enabled's doc comment for why
	// that silently reverts an explicit false back to true on Create.
	Enable bool
}

// PanelSettings is the panel's own network/TLS configuration — editable at
// runtime via the Settings page, mirroring 3x-ui's "Panel Settings" tab
// (listen IP/domain/port, URI base path, TLS cert for the panel's own web
// UI). Singleton row (ID is always 1, seeded at startup — see db.go).
// Unlike everything else in this file, main.go reads this once at process
// startup to build the http.Server; saving a change here only takes effect
// after the panel process is restarted (same restart requirement 3x-ui
// itself has for these fields) — there's no in-process hot-rebind of the
// listener/TLS/base-path here.
type PanelSettings struct {
	gorm.Model
	ListenIP     string // empty = all interfaces
	ListenDomain string // empty = any Host header accepted
	ListenPort   int    // 0 = use the WTP_LISTEN_ADDR/default port
	BasePath     string `gorm:"default:/"` // must start and end with '/'
	TLSCertFile  string
	TLSKeyFile   string
	// PublicIP is the VPS's own public IP/hostname, baked into every
	// profile's client-facing config (Turnable/FreeTurn — see their
	// provisioner packages). Auto-detected and pre-filled on first run
	// (see db.seedPanelSettings) since a wrong or missing value here is
	// exactly what produces Turnable's "public_ip is required" startup
	// failure — but auto-detection can guess wrong (multi-homed box,
	// NAT/CDN in front, IPv6-only egress), so it's a plain editable field
	// here, same restart-required semantics as the rest of this struct.
	PublicIP string
	// WebDAVPublicHost overrides the host baked into a selfhosted WebDAV
	// profile's client URI when it should differ from PublicIP — e.g. the
	// panel's own TLS cert is issued for a domain (ListenDomain) rather than
	// the bare IP, and that domain should be advertised to WebDAV clients
	// too, or a separate DNS record is used just for WebDAV. Empty means
	// "same as PublicIP" — see config.Config.ResolvedWebDAVPublicHost.
	WebDAVPublicHost string
}

// KernelInstall records the currently installed binary for one kernel —
// one row per CoreType (Turnable, FreeTurn, olcRTC). Turnable/FreeTurn are
// installed from a GitHub release (Version = release tag); olcRTC has no
// releases upstream, so it's built from source at a chosen commit
// (Version = short/full commit SHA, Source = "build").
type KernelInstall struct {
	gorm.Model
	CoreType    CoreType `gorm:"uniqueIndex;not null"`
	Version     string   `gorm:"not null"` // release tag or commit SHA
	Source      string   `gorm:"not null"` // "release" or "build"
	InstalledAt time.Time
	BuildLog    string `gorm:"type:text"` // only meaningful for Source == "build"
}
