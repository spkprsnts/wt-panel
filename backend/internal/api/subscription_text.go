package api

import (
	"fmt"
	"strings"

	"wtpanel/internal/models"
)

// buildTextSubscription renders the line-based fallback format documented in
// docs/subscriptions.md §5.5 — kernel-scheme links with "##key:value"
// per-profile tags and "#key:value" subscription-level tags. It's a
// reduced-fidelity view (no Dual Route, no mux/health-check — those only
// exist in the ProfileBundle JSON's vlessConfig) meant for whatever can't
// parse JSON: generic subscription managers, or a browser's raw-view.
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

// encodeWireGuardConfigText renders WgConfig as a minimal [Interface]/[Peer]
// config text, Base64-encoded (standard alphabet, per §5.5 — this is a
// single tag VALUE, unlike the URL-safe encoding the wireturn:// container
// itself uses). Only the fields the spec's wgConfig actually carries are
// included — no Endpoint/AllowedIPs, since we have no real value for either
// and the app is documented to fill both in itself.
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
