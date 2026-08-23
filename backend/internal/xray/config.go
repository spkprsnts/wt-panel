// Package xray turns the panel's stored XrayInbound/XrayClient rows into a
// real xray-core process — the "make Xray actually work" step the rest of
// the codebase (the Xray page, the profile create dialog's overlay picker)
// was deliberately built ahead of, see README "Статус реализации".
//
// Unlike the four kernel provisioners (one process per profile), Xray-core
// is one shared process serving every enabled inbound at once — the same
// model 3x-ui uses, and the reason attaching a client to an inbound never
// spins up anything extra: it's just another entry in one process's config.
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

// BuildConfig assembles the full xray-core config.json from every enabled
// XrayInbound and its attached XrayClients. enabledCount is how many
// inbounds ended up in the config — the caller (Manager.Reload) uses 0 to
// mean "nothing to serve, stop the process" rather than starting xray-core
// with an empty inbound list.
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
		cfg.Inbounds = append(cfg.Inbounds, inboundConfig{
			Tag:            fmt.Sprintf("inbound-%d", ib.ID),
			Listen:         ib.Listen,
			Port:           ib.Port,
			Protocol:       ib.Protocol,
			Settings:       settings,
			StreamSettings: rawOrNil(ib.StreamSettings),
			Sniffing:       rawOrNil(ib.Sniffing),
		})
	}

	data, err = json.MarshalIndent(cfg, "", "  ")
	return data, len(cfg.Inbounds), err
}

// injectClients merges an inbound's attached XrayClient rows into its
// stored Settings JSON — the panel keeps client identity in its own table
// (see models.XrayClient's doc comment for why), but xray-core itself only
// understands a "clients" array (vless/trojan/hysteria2) or "peers"
// (wireguard) living directly inside the inbound's settings object, so
// this is where the two get stitched back together into a real config.
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
		// The wireguard inbound's own Settings.publicKey (see XrayPage.tsx)
		// is UI-only — a convenience copy of the server's public key to show
		// the operator, not a real xray-core wireguard-inbound field — drop
		// it before it reaches the actual config.
		delete(settings, "publicKey")

		// xray-core's WireGuardConfig.Address is []string — an inbound saved
		// before that was enforced on the frontend may still have a bare
		// string on record, which xray-core's own JSON unmarshal rejects
		// outright ("cannot unmarshal string into ... []string"), taking the
		// whole process down at startup. Normalize it here so an old row
		// self-heals without the operator having to re-open and re-save it.
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

func rawOrNil(s string) json.RawMessage {
	if s == "" {
		return nil
	}
	return json.RawMessage(s)
}
