// Package xray turns the panel's stored XrayInbound/XrayClient rows into a
// real xray-core process.
//
// Unlike the four kernel provisioners (one process per profile), Xray-core
// is one shared process serving every enabled inbound — same model as 3x-ui — so attaching a client never spins up anything extra.
package xray

import (
	"encoding/json"
	"fmt"

	"gorm.io/gorm"

	"wtpanel/internal/models"
)

type coreConfig struct {
	Log       logConfig        `json:"log"`
	Inbounds  []inboundConfig  `json:"inbounds"`
	Outbounds []outboundConfig `json:"outbounds"`
	Routing   *routingConfig   `json:"routing,omitempty"`
}

type routingConfig struct {
	Rules []routingRule `json:"rules"`
}

type routingRule struct {
	Type        string   `json:"type"`
	InboundTag  []string `json:"inboundTag"`
	OutboundTag string   `json:"outboundTag"`
}

type logConfig struct {
	Loglevel string `json:"loglevel"`
}

type inboundConfig struct {
	Tag            string          `json:"tag"`
	Listen         string          `json:"listen,omitempty"`
	Port           int             `json:"port"`
	Protocol       string          `json:"protocol"`
	Settings       json.RawMessage `json:"settings,omitempty"`
	StreamSettings json.RawMessage `json:"streamSettings,omitempty"`
	Sniffing       json.RawMessage `json:"sniffing,omitempty"`
}

type outboundConfig struct {
	Tag      string          `json:"tag"`
	Protocol string          `json:"protocol"`
	Settings json.RawMessage `json:"settings,omitempty"`
}

// directLANTag is a second freedom outbound for inbounds with AllowPrivate:
// its finalRules allow what xray-core (newer than v26.3.27) blocks by default
// for vless/trojan/hysteria/wireguard. Older cores ignore finalRules and never
// blocked private ranges, so the extra outbound is harmless there.
const directLANTag = "direct-lan"

// directLANSettings allows exactly xray-core's own default-blocked private
// ranges (common/geodata/consts.go). Plain CIDRs rather than "geoip:private",
// since the panel installs only the xray binary, without geoip.dat.
var directLANSettings = json.RawMessage(`{"finalRules":[{"action":"allow","network":"tcp,udp","ip":[` +
	`"0.0.0.0/8","10.0.0.0/8","100.64.0.0/10","127.0.0.0/8","169.254.0.0/16","172.16.0.0/12",` +
	`"192.0.0.0/24","192.0.2.0/24","192.88.99.0/24","192.168.0.0/16","198.18.0.0/15",` +
	`"198.51.100.0/24","203.0.113.0/24","224.0.0.0/3","::/127","fc00::/7","fe80::/10","ff00::/8"]}]}`)

// BuildConfig assembles xray-core's config.json from every enabled
// XrayInbound. enabledCount lets Manager.Reload treat 0 as "stop the process" rather than starting with an empty inbound list.
func BuildConfig(db *gorm.DB) (data []byte, enabledCount int, err error) {
	var inbounds []models.XrayInbound
	if err := db.Preload("Clients").Where("enable = ?", true).Find(&inbounds).Error; err != nil {
		return nil, 0, err
	}

	cfg := coreConfig{
		Log:       logConfig{Loglevel: "warning"},
		Outbounds: []outboundConfig{{Tag: "direct", Protocol: "freedom"}},
	}

	var lanTags []string
	for _, ib := range inbounds {
		settings, err := injectClients(ib)
		if err != nil {
			return nil, 0, fmt.Errorf("inbound %q (%s, id %d): %w", ib.Remark, ib.Protocol, ib.ID, err)
		}
		streamSettings := rawOrNil(ib.StreamSettings)
		if ib.Protocol == "hysteria2" {
			streamSettings = fixHysteriaStreamSettings(ib.StreamSettings)
		}
		tag := fmt.Sprintf("inbound-%d", ib.ID)
		if ib.AllowPrivate {
			lanTags = append(lanTags, tag)
		}
		cfg.Inbounds = append(cfg.Inbounds, inboundConfig{
			Tag:            tag,
			Listen:         ib.Listen,
			Port:           ib.Port,
			Protocol:       xrayCoreProtocol(ib.Protocol),
			Settings:       settings,
			StreamSettings: streamSettings,
			Sniffing:       rawOrNil(ib.Sniffing),
		})
	}

	// "direct" stays first, so it remains the default outbound for every
	// other inbound; only the AllowPrivate ones are routed to direct-lan.
	if len(lanTags) > 0 {
		cfg.Outbounds = append(cfg.Outbounds, outboundConfig{Tag: directLANTag, Protocol: "freedom", Settings: directLANSettings})
		cfg.Routing = &routingConfig{Rules: []routingRule{{Type: "field", InboundTag: lanTags, OutboundTag: directLANTag}}}
	}

	data, err = json.MarshalIndent(cfg, "", "  ")
	return data, len(cfg.Inbounds), err
}

// injectClients merges an inbound's XrayClient rows into its Settings JSON
// — xray-core wants a "clients" (vless/trojan/hysteria2) or "peers"
// (wireguard) array inside settings, so this stitches the two together.
func injectClients(ib models.XrayInbound) (json.RawMessage, error) {
	settings := map[string]any{}
	if ib.Settings != "" {
		if err := json.Unmarshal([]byte(ib.Settings), &settings); err != nil {
			return nil, fmt.Errorf("parse settings: %w", err)
		}
	}

	switch ib.Protocol {
	case "vless", "trojan", "hysteria2":
		clients := make([]any, 0, len(ib.Clients))
		for _, xc := range ib.Clients {
			if !xc.Enable {
				continue
			}
			var c map[string]any
			if err := json.Unmarshal([]byte(xc.Config), &c); err != nil {
				continue // a malformed row shouldn't take down every other inbound
			}
			clients = append(clients, c)
		}
		settings["clients"] = clients

	case "wireguard":
		// Settings.publicKey (see XrayPage.tsx) is UI-only — a convenience
		// copy for the operator, not a real xray-core field — drop it before it reaches the config.
		delete(settings, "publicKey")

		// xray-core's WireGuardConfig.Address is []string; an inbound saved
		// before that was enforced may still have a bare string, which
		// xray-core's JSON unmarshal rejects outright, crashing the process
		// at startup. Normalize it here so an old row self-heals without a re-save.
		if addr, ok := settings["address"].(string); ok {
			settings["address"] = []string{addr}
		}

		peers := make([]any, 0, len(ib.Clients))
		for _, xc := range ib.Clients {
			if !xc.Enable {
				continue
			}
			var c map[string]any
			if err := json.Unmarshal([]byte(xc.Config), &c); err != nil {
				continue
			}
			pub, _ := c["publicKey"].(string)
			if pub == "" {
				continue
			}
			peers = append(peers, map[string]any{
				"publicKey":  pub,
				"allowedIPs": []string{DeriveWireGuardPeerAddress(xc.ID) + "/32"},
			})
		}
		settings["peers"] = peers
	}

	return json.Marshal(settings)
}

// xrayCoreProtocol translates our stored Protocol into xray-core's own
// config-loader id — every value round-trips except "hysteria2", whose real
// id is "hysteria" (sending "hysteria2" crashed at startup: "unknown config
// id"). Translated at this one boundary rather than renaming stored rows — no migration needed.
func xrayCoreProtocol(p string) string {
	if p == "hysteria2" {
		return "hysteria"
	}
	return p
}

// fixHysteriaStreamSettings self-heals a stored hysteria2 streamSettings
// still shaped like an older frontend build (network:"tcp") into what
// xray-core actually requires (network:"hysteria" + hysteriaSettings) — no
// manual re-save needed. No-op once buildPayload has written "hysteria".
func fixHysteriaStreamSettings(raw string) json.RawMessage {
	def := json.RawMessage(`{"network":"hysteria","hysteriaSettings":{"version":2}}`)
	if raw == "" {
		return def
	}
	var ss map[string]any
	if err := json.Unmarshal([]byte(raw), &ss); err != nil {
		return json.RawMessage(raw)
	}
	if network, _ := ss["network"].(string); network == "hysteria" {
		return json.RawMessage(raw)
	}
	ss["network"] = "hysteria"
	delete(ss, "tcpSettings")
	ss["hysteriaSettings"] = map[string]any{"version": 2}
	fixed, err := json.Marshal(ss)
	if err != nil {
		return json.RawMessage(raw)
	}
	return fixed
}

func rawOrNil(s string) json.RawMessage {
	if s == "" {
		return nil
	}
	return json.RawMessage(s)
}
