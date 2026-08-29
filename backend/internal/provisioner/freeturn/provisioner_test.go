package freeturn

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"wtpanel/internal/config"
)

// decodeURI reverses buildURI's own encoding so a test can inspect the raw
// wire JSON, not just the opaque freeturn:// string.
func decodeURI(t *testing.T, uri string) map[string]any {
	t.Helper()
	payload := strings.TrimPrefix(uri, "freeturn://")
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal json: %v", err)
	}
	return m
}

// TestBuildURILinksIsAString guards against a real interop bug: this field
// used to be a Go []string, which marshals as a JSON array. WireTurn's own
// parser (AppPreferences.kt's FreeTurnConfig.parse) reads "links" via
// Gson's asString — handed a JSON array instead of a string, that throws,
// parse()'s catch-all turns it into a null, and the *entire* URI (every
// field, not just links) silently fails to import. See buildURI's own doc
// comment on freeturnURI.Links.
func TestBuildURILinksIsAString(t *testing.T) {
	cfg := &config.Config{PublicIP: "1.2.3.4"}
	cc := profileCoreConfig{
		Provider: "vk",
		Links:    []string{"ABC123xyz", "DEF456uvw"},
		Port:     56000,
	}

	uri := buildURI(cfg, cc)
	m := decodeURI(t, uri)

	links, ok := m["links"].(string)
	if !ok {
		t.Fatalf("links is %T (%v), want a JSON string", m["links"], m["links"])
	}
	if want := "ABC123xyz,DEF456uvw"; links != want {
		t.Errorf("links = %q, want %q", links, want)
	}
}

// TestBuildURIOmitsDefaultTransportAndMode matches the WireTurn app's own
// URI generator (FreeTurnConfig.toUri), which only writes "transport"/"mode"
// when they differ from the client's own defaults ("tcp"/"udp") — keeping
// wt-panel's links the same shape keeps them exactly as short.
func TestBuildURIOmitsDefaultTransportAndMode(t *testing.T) {
	cfg := &config.Config{PublicIP: "1.2.3.4"}
	cc := profileCoreConfig{
		Provider:  "vk",
		Transport: "tcp",
		Mode:      "udp",
		Port:      56000,
	}

	m := decodeURI(t, buildURI(cfg, cc))

	if _, present := m["transport"]; present {
		t.Errorf("transport should be omitted at its \"tcp\" default, got %v", m["transport"])
	}
	if _, present := m["mode"]; present {
		t.Errorf("mode should be omitted at its \"udp\" default, got %v", m["mode"])
	}
}

// TestBuildURIIncludesModeAndKCPForTCP is the mirror case: a non-default
// mode (and its KCP profile) must actually make it into the link.
func TestBuildURIIncludesModeAndKCPForTCP(t *testing.T) {
	cfg := &config.Config{PublicIP: "1.2.3.4"}
	cc := profileCoreConfig{
		Provider:  "vk",
		Transport: "udp",
		Mode:      "tcp",
		Port:      56000,
		KCP: &kcpOpts{
			NoDelay: 1, Interval: 20, Resend: 2, NC: 1,
			SndWnd: 512, RcvWnd: 512, MTU: 1200, ACKNoDelay: true,
		},
	}

	m := decodeURI(t, buildURI(cfg, cc))

	if got := m["transport"]; got != "udp" {
		t.Errorf("transport = %v, want \"udp\"", got)
	}
	if got := m["mode"]; got != "tcp" {
		t.Errorf("mode = %v, want \"tcp\"", got)
	}
	kcp, ok := m["kcp"].(map[string]any)
	if !ok {
		t.Fatalf("kcp is %T, want an object", m["kcp"])
	}
	if got := kcp["mtu"]; got != float64(1200) {
		t.Errorf("kcp.mtu = %v, want 1200", got)
	}
}
