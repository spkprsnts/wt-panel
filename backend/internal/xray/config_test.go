package xray

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"wtpanel/internal/models"
)

func testDB(t *testing.T, inbounds ...models.XrayInbound) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.XrayInbound{}, &models.XrayClient{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for i := range inbounds {
		if err := db.Create(&inbounds[i]).Error; err != nil {
			t.Fatalf("create inbound: %v", err)
		}
	}
	return db
}

func buildTestConfig(t *testing.T, db *gorm.DB) coreConfig {
	t.Helper()
	data, _, err := BuildConfig(db)
	if err != nil {
		t.Fatalf("BuildConfig: %v", err)
	}
	var cfg coreConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}
	return cfg
}

// TestBuildConfigRoutesAllowPrivateToDirectLAN: only AllowPrivate inbounds
// reach direct-lan, and "direct" stays first so it remains the default.
func TestBuildConfigRoutesAllowPrivateToDirectLAN(t *testing.T) {
	db := testDB(t,
		models.XrayInbound{Protocol: "vless", Remark: "lan", Port: 20001, Enable: true, AllowPrivate: true},
		models.XrayInbound{Protocol: "vless", Remark: "plain", Port: 20002, Enable: true},
	)
	cfg := buildTestConfig(t, db)

	if len(cfg.Outbounds) != 2 || cfg.Outbounds[0].Tag != "direct" || cfg.Outbounds[1].Tag != directLANTag {
		t.Fatalf("outbounds = %+v, want [direct, %s]", cfg.Outbounds, directLANTag)
	}
	var lan struct {
		FinalRules []struct {
			Action string   `json:"action"`
			IP     []string `json:"ip"`
		} `json:"finalRules"`
	}
	if err := json.Unmarshal(cfg.Outbounds[1].Settings, &lan); err != nil {
		t.Fatalf("unmarshal direct-lan settings: %v", err)
	}
	if len(lan.FinalRules) != 1 || lan.FinalRules[0].Action != "allow" || len(lan.FinalRules[0].IP) == 0 {
		t.Errorf("direct-lan finalRules = %+v, want one allow rule over the private ranges", lan.FinalRules)
	}
	if cfg.Routing == nil || len(cfg.Routing.Rules) != 1 {
		t.Fatalf("routing = %+v, want exactly one rule", cfg.Routing)
	}
	rule := cfg.Routing.Rules[0]
	if rule.OutboundTag != directLANTag || len(rule.InboundTag) != 1 || rule.InboundTag[0] != cfg.Inbounds[0].Tag {
		t.Errorf("rule = %+v, want only %s routed to %s", rule, cfg.Inbounds[0].Tag, directLANTag)
	}
}

func TestBuildConfigWithoutAllowPrivateHasNoRouting(t *testing.T) {
	db := testDB(t, models.XrayInbound{Protocol: "vless", Remark: "plain", Port: 20002, Enable: true})
	cfg := buildTestConfig(t, db)

	if len(cfg.Outbounds) != 1 || cfg.Routing != nil {
		t.Errorf("outbounds = %+v, routing = %+v; want just direct and no routing", cfg.Outbounds, cfg.Routing)
	}
}

func TestBuildClientLinkHysteria2Salamander(t *testing.T) {
	inbound := models.XrayInbound{
		Protocol:       "hysteria2",
		Port:           443,
		StreamSettings: `{"network":"hysteria","security":"tls","tlsSettings":{"serverName":"example.com"},"finalmask":{"udp":[{"type":"salamander","settings":{"password":"s3cret"}}]}}`,
	}
	client := models.XrayClient{Config: `{"auth":"pass"}`}

	link, err := BuildClientLink(inbound, client, "hy", "1.2.3.4")
	if err != nil {
		t.Fatalf("BuildClientLink: %v", err)
	}
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("parse link %q: %v", link, err)
	}
	q := u.Query()
	if q.Get("obfs") != "salamander" || q.Get("obfs-password") != "s3cret" {
		t.Errorf("link %q: obfs=%q obfs-password=%q, want salamander/s3cret", link, q.Get("obfs"), q.Get("obfs-password"))
	}

	inbound.StreamSettings = `{"network":"hysteria","security":"tls"}`
	link, _ = BuildClientLink(inbound, client, "hy", "1.2.3.4")
	if strings.Contains(link, "obfs") {
		t.Errorf("link %q should carry no obfs without a salamander mask", link)
	}
}
