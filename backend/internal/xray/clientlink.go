package xray

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"wtpanel/internal/models"
)

// DeriveWireGuardPeerAddress deterministically assigns a client its
// 10.x.x.x address inside the server's subnet from the XrayClient row's own
// id — nothing upstream assigns one per client otherwise. Shared by
// injectClients (what the server's own peers list allows) and
// BuildWireGuardConfig (what the client is told its own address is) so the
// two can never drift apart — collision-free up to 250*250 peers per
// inbound, far beyond what a single WireGuard inbound is for.
func DeriveWireGuardPeerAddress(clientRowID uint) string {
	return fmt.Sprintf("10.%d.%d.%d", 200+(clientRowID/65000)%50, (clientRowID/250)%250, 2+int(clientRowID%250))
}

// BuildClientLink builds the real client-facing vless://, trojan://, or
// hysteria2:// URI for one XrayClient attached to an XrayInbound, matching
// xray-core/3x-ui's own link conventions — see WireTurn's
// docs/subscriptions.md §3: vlessConfig.vlessLink is meant to be one of
// these real links, not a resolved-settings JSON blob (an earlier version
// of this panel sent the latter, which no real WireTurn client can parse).
//
// host:port here still has to be *something* syntactically valid even
// though the WireTurn client ignores it whenever this link rides on top of
// a kernel tunnel (docs/subscriptions.md §3: "адрес и порт в ссылке
// игнорируются — подставляется локальный адрес ядра") — inbound.Listen is a
// bind address, not necessarily a reachable one: empty/"0.0.0.0" means "all
// interfaces", which no external client could ever dial, so that case falls
// back to publicIP (the panel's own config.Config.PublicIP). A specific
// non-wildcard Listen (the operator pinned this inbound to one interface on
// purpose) is trusted as-is.
func BuildClientLink(inbound models.XrayInbound, client models.XrayClient, remark, publicIP string) (string, error) {
	clientCfg, err := decodeJSONObject(client.Config)
	if err != nil {
		return "", fmt.Errorf("parse client config: %w", err)
	}
	stream, err := decodeJSONObject(inbound.StreamSettings)
	if err != nil {
		return "", fmt.Errorf("parse stream settings: %w", err)
	}

	host := inbound.Listen
	if host == "" || host == "0.0.0.0" {
		host = publicIP
	}
	if host == "" {
		host = "127.0.0.1"
	}

	q := url.Values{}
	network, _ := stream["network"].(string)
	if network == "" {
		network = "tcp"
	}
	security, _ := stream["security"].(string)
	if security == "" {
		security = "none"
	}
	q.Set("type", network)
	q.Set("security", security)
	applyNetworkParams(q, network, stream)
	applySecurityParams(q, security, stream)

	frag := "#" + url.PathEscape(remark)

	switch inbound.Protocol {
	case "vless":
		q.Set("encryption", "none")
		if flow, _ := clientCfg["flow"].(string); flow != "" {
			q.Set("flow", flow)
		}
		id, _ := clientCfg["id"].(string)
		return fmt.Sprintf("vless://%s@%s:%d?%s%s", id, host, inbound.Port, q.Encode(), frag), nil
	case "trojan":
		password, _ := clientCfg["password"].(string)
		return fmt.Sprintf("trojan://%s@%s:%d?%s%s", url.QueryEscape(password), host, inbound.Port, q.Encode(), frag), nil
	case "hysteria2":
		auth, _ := clientCfg["auth"].(string)
		// hysteria2 is always TLS-only in this panel's schema (see
		// buildPayload in XrayPage.tsx) — sni comes straight from its
		// tlsSettings, already folded into q by applySecurityParams above,
		// but hysteria2 clients conventionally use "insecure" rather than
		// xray's own security/type params, so build a narrower query set.
		hq := url.Values{}
		if sni := q.Get("sni"); sni != "" {
			hq.Set("sni", sni)
		}
		return fmt.Sprintf("hysteria2://%s@%s:%d?%s%s", url.QueryEscape(auth), host, inbound.Port, hq.Encode(), frag), nil
	}
	return "", fmt.Errorf("unsupported protocol for client link: %s", inbound.Protocol)
}

// BuildWireGuardConfig resolves WireTurn's structured wgConfig (§3) for one
// client attached to a wireguard XrayInbound — the client's own keypair
// plus the server's public key (a UI-convenience copy already sitting on
// the inbound's own Settings, see XrayPage.tsx) and its assigned address
// (must match DeriveWireGuardPeerAddress exactly, since that's also what
// the server's own peers list allows — see config.go's injectClients).
func BuildWireGuardConfig(inbound models.XrayInbound, client models.XrayClient) (privateKey, publicKey, address, mtu string, err error) {
	clientCfg, err := decodeJSONObject(client.Config)
	if err != nil {
		return "", "", "", "", fmt.Errorf("parse client config: %w", err)
	}
	inboundSettings, err := decodeJSONObject(inbound.Settings)
	if err != nil {
		return "", "", "", "", fmt.Errorf("parse inbound settings: %w", err)
	}
	privateKey, _ = clientCfg["privateKey"].(string)
	publicKey, _ = inboundSettings["publicKey"].(string)
	if mtuNum, ok := inboundSettings["mtu"].(float64); ok && mtuNum > 0 {
		mtu = fmt.Sprintf("%.0f", mtuNum)
	}
	address = DeriveWireGuardPeerAddress(client.ID) + "/32"
	return privateKey, publicKey, address, mtu, nil
}

// ParseWireGuardConfigText extracts the handful of fields WireTurn's
// wgConfig actually needs from a pasted [Interface]/[Peer]-style config
// text (the panel's manual-fallback UI for a profile with no matching
// inbound yet) — endpoint is deliberately not extracted, since the spec
// says the client always overrides it with the local kernel address
// regardless of what's sent (docs/subscriptions.md §3).
func ParseWireGuardConfigText(raw string) (privateKey, publicKey, address, mtu string) {
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		idx := strings.Index(line, "=")
		if idx < 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:idx]))
		value := strings.TrimSpace(line[idx+1:])
		switch key {
		case "privatekey":
			privateKey = value
		case "publickey":
			publicKey = value
		case "address":
			address = value
		case "mtu":
			mtu = value
		}
	}
	return
}

func decodeJSONObject(raw string) (map[string]any, error) {
	if raw == "" {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

func applyNetworkParams(q url.Values, network string, stream map[string]any) {
	sub, _ := stream[network+"Settings"].(map[string]any)
	if sub == nil {
		return
	}
	switch network {
	case "ws":
		setIfNonEmpty(q, "path", sub["path"])
		setIfNonEmpty(q, "host", sub["host"])
	case "grpc":
		setIfNonEmpty(q, "serviceName", sub["serviceName"])
		setIfNonEmpty(q, "authority", sub["authority"])
		if multi, _ := sub["multiMode"].(bool); multi {
			q.Set("mode", "multi")
		} else {
			q.Set("mode", "gun")
		}
	case "httpupgrade":
		setIfNonEmpty(q, "path", sub["path"])
		setIfNonEmpty(q, "host", sub["host"])
	case "xhttp":
		setIfNonEmpty(q, "path", sub["path"])
		setIfNonEmpty(q, "host", sub["host"])
		setIfNonEmpty(q, "mode", sub["mode"])
	case "tcp":
		if header, ok := sub["header"].(map[string]any); ok {
			if t, _ := header["type"].(string); t != "" && t != "none" {
				q.Set("headerType", t)
			}
		}
	}
}

func applySecurityParams(q url.Values, security string, stream map[string]any) {
	switch security {
	case "tls":
		tls, _ := stream["tlsSettings"].(map[string]any)
		if tls == nil {
			return
		}
		setIfNonEmpty(q, "sni", tls["serverName"])
		if alpnList, ok := tls["alpn"].([]any); ok && len(alpnList) > 0 {
			parts := make([]string, 0, len(alpnList))
			for _, a := range alpnList {
				if s, ok := a.(string); ok {
					parts = append(parts, s)
				}
			}
			if len(parts) > 0 {
				q.Set("alpn", strings.Join(parts, ","))
			}
		}
		if inner, ok := tls["settings"].(map[string]any); ok {
			setIfNonEmpty(q, "fp", inner["fingerprint"])
		}
	case "reality":
		reality, _ := stream["realitySettings"].(map[string]any)
		if reality == nil {
			return
		}
		if names, ok := reality["serverNames"].([]any); ok && len(names) > 0 {
			setIfNonEmpty(q, "sni", names[0])
		}
		if ids, ok := reality["shortIds"].([]any); ok && len(ids) > 0 {
			setIfNonEmpty(q, "sid", ids[0])
		}
		if inner, ok := reality["settings"].(map[string]any); ok {
			setIfNonEmpty(q, "fp", inner["fingerprint"])
			setIfNonEmpty(q, "pbk", inner["publicKey"])
			setIfNonEmpty(q, "spx", inner["spiderX"])
		}
	}
}

func setIfNonEmpty(q url.Values, key string, v any) {
	if s, ok := v.(string); ok && s != "" {
		q.Set(key, s)
	}
}
