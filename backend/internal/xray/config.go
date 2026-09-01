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
	Tag      string `json:"tag"`
	Protocol string `json:"protocol"`
}

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

	for _, ib := range inbounds {
		settings, err := injectClients(ib)
		if err != nil {
			return nil, 0, fmt.Errorf("inbound %q (%s, id %d): %w", ib.Remark, ib.Protocol, ib.ID, err)
		}
		streamSettings := rawOrNil(ib.StreamSettings)
		if ib.Protocol == "hysteria2" {
			streamSettings = fixHysteriaStreamSettings(ib.StreamSettings)
		}
		cfg.Inbounds = append(cfg.Inbounds, inboundConfig{
			Tag:            fmt.Sprintf("inbound-%d", ib.ID),
			Listen:         ib.Listen,
			Port:           ib.Port,
			Protocol:       xrayCoreProtocol(ib.Protocol),
			Settings:       settings,
			StreamSettings: streamSettings,
			Sniffing:       rawOrNil(ib.Sniffing),
		})
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
