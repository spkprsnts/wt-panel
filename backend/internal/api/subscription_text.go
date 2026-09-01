package api

import (
	"fmt"
	"strings"

	"wtpanel/internal/models"
)

// buildTextSubscription renders the line-based fallback format from §5.5 — kernel-scheme links with
// "##key:value" per-profile tags and "#key:value" subscription-level tags, for whatever can't parse
// JSON. Reduced-fidelity: no Dual Route/mux/health-check, which only exist in the JSON vlessConfig.
func (s *Server) buildTextSubscription(client models.Client, bytesUsed, bytesTotal int64) string {
	var b strings.Builder
	fmt.Fprintf(&b, "#name:%s\n", client.Name)
	if client.Description != "" {
		fmt.Fprintf(&b, "#description:%s\n", client.Description)
	}
	fmt.Fprintf(&b, "#refresh:%dm\n", updateIntervalOrDefault(client.UpdateIntervalMinutes))
	if bytesTotal > 0 {
		fmt.Fprintf(&b, "#used:%s/%s\n", formatBytesShort(bytesUsed), formatBytesShort(bytesTotal))
	}

	for _, profile := range client.Profiles {
		if profile.KernelURI == "" {
			continue
		}
		b.WriteString("\n")
		b.WriteString(profile.KernelURI)
		b.WriteString("\n")
		fmt.Fprintf(&b, "##name:%s\n", profile.Name)
		fmt.Fprintf(&b, "##id:%s\n", profile.ExternalID)

		if !profile.XrayEnabled {
			continue
		}
		protocol, vless, wg := s.buildXrayBundleConfig(&profile)
		switch protocol {
		case "VLESS":
			if vless != nil && vless.VlessLink != "" {
				fmt.Fprintf(&b, "##xray:%s\n", vless.VlessLink)
			}
		case "WIREGUARD":
			if wg != nil {
				fmt.Fprintf(&b, "##xray-wg:%s\n", encodeWireGuardConfigText(wg))
			}
		}
	}
	return b.String()
}

// encodeWireGuardConfigText renders WgConfig as a minimal [Interface]/[Peer] config text,
// standard-Base64-encoded per §5.5 (a single tag value, unlike wireturn://'s URL-safe encoding). No
// Endpoint/AllowedIPs — the app fills those in itself.
func encodeWireGuardConfigText(wg *WgConfig) string {
	var b strings.Builder
	b.WriteString("[Interface]\n")
	fmt.Fprintf(&b, "PrivateKey = %s\n", wg.PrivateKey)
	if wg.Address != "" {
		fmt.Fprintf(&b, "Address = %s\n", wg.Address)
	}
	if wg.Mtu != "" {
		fmt.Fprintf(&b, "MTU = %s\n", wg.Mtu)
	}
	b.WriteString("\n[Peer]\n")
	fmt.Fprintf(&b, "PublicKey = %s\n", wg.PublicKey)
	if wg.PersistentKeepalive != "" {
		fmt.Fprintf(&b, "PersistentKeepalive = %s\n", wg.PersistentKeepalive)
	}
	return base64StdEncode(b.String())
}
