package freeturn

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"wtpanel/internal/config"
	"wtpanel/internal/models"
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
// used to be []string (marshals as a JSON array); WireTurn's Gson-based
// parser reads "links" via asString and throws on an array, silently failing the whole URI import. See freeturnURI.Links.
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

// TestBuildURIOmitsDefaultTransportAndMode matches WireTurn's own URI
// generator, which omits "transport"/"mode" at their defaults ("tcp"/"udp").
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
	if _, present := m["n"]; present {
		t.Errorf("n should be omitted for provider vk, got %v", m["n"])
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

// TestBuildURIUpstreamKeys covers upstream's own client (4.0+), which
// ignores "links"/"obft" and reads "vk" and integer-ms "timing" instead.
func TestBuildURIUpstreamKeys(t *testing.T) {
	cfg := &config.Config{PublicIP: "1.2.3.4"}
	cc := profileCoreConfig{
		Provider:   "vk",
		Links:      []string{"ABC123xyz", "DEF456uvw"},
		ObfProfile: "rtpopus",
		ObfKey:     strings.Repeat("ab", 32),
		ObfTiming:  "10ms",
		Port:       56000,
	}

	m := decodeURI(t, buildURI(cfg, cc))

	// Only the first link: the official Android app treats "vk" as one link.
	if got := m["vk"]; got != "ABC123xyz" {
		t.Errorf("vk = %v, want the first link only", got)
	}
	if got := m["obft"]; got != "10ms" {
		t.Errorf("obft = %v, want \"10ms\" (still needed by WireTurn)", got)
	}
	if got := m["timing"]; got != float64(10) {
		t.Errorf("timing = %v, want 10", got)
	}

	cc.ObfProfile = "none"
	m = decodeURI(t, buildURI(cfg, cc))
	if _, present := m["timing"]; present {
		t.Errorf("timing should be omitted without obfuscation, got %v", m["timing"])
	}
}

// TestBuildURIDirectOmitsCallFields: "direct" dials the peer without the
// call relay, so the link carries no call ids or relay transport.
func TestBuildURIDirectOmitsCallFields(t *testing.T) {
	cfg := &config.Config{PublicIP: "1.2.3.4"}
	cc := profileCoreConfig{
		Provider:  "direct",
		Links:     []string{"ABC123xyz"},
		Transport: "udp",
		Port:      56000,
	}

	m := decodeURI(t, buildURI(cfg, cc))

	if got := m["provider"]; got != "direct" {
		t.Errorf("provider = %v, want \"direct\"", got)
	}
	if got := m["n"]; got != float64(1) {
		t.Errorf("n = %v, want 1 (WireTurn otherwise imports its relay default)", got)
	}
	for _, key := range []string{"links", "vk", "transport"} {
		if _, present := m[key]; present {
			t.Errorf("%s should be omitted for provider direct, got %v", key, m[key])
		}
	}
}

// TestBuildURIBondOnlyInTCPMode: upstream rejects -bond outside -mode tcp.
func TestBuildURIBondOnlyInTCPMode(t *testing.T) {
	cfg := &config.Config{PublicIP: "1.2.3.4"}
	cc := profileCoreConfig{Provider: "vk", Mode: "tcp", Bond: true, Port: 56000}

	if got := decodeURI(t, buildURI(cfg, cc))["bond"]; got != true {
		t.Errorf("bond = %v, want true in tcp mode", got)
	}

	cc.Mode = "udp"
	if got, present := decodeURI(t, buildURI(cfg, cc))["bond"]; present {
		t.Errorf("bond should be omitted in udp mode, got %v", got)
	}
}

func TestApplyLogicalDefaultsRejectsUnknownProvider(t *testing.T) {
	p := New(&config.Config{DataDir: t.TempDir()})
	profile := &models.Profile{CoreConfig: `{"provider":"telemost","connect_port":51820}`}

	if _, err := p.applyLogicalDefaults(profile); err == nil {
		t.Error("want an error for an unknown provider")
	}
}
