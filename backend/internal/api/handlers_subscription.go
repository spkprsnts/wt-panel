package api

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/models"
	"wtpanel/internal/xray"
)

// getOrCreateSubscriptionToken reuses a client's existing token if it has
// one — repeated calls (e.g. every time the admin re-opens the QR dialog)
// must not mint a fresh, independently-valid token every time.
func (s *Server) getOrCreateSubscriptionToken(client *models.Client) (*models.SubscriptionToken, error) {
	var token models.SubscriptionToken
	err := s.db.Where("client_id = ?", client.ID).Order("id").First(&token).Error
	if err == nil {
		return &token, nil
	}

	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	token = models.SubscriptionToken{
		ClientID: client.ID,
		Token:    base64.RawURLEncoding.EncodeToString(raw),
	}
	if err := s.db.Create(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func (s *Server) createSubscriptionToken(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}
	token, err := s.getOrCreateSubscriptionToken(client)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"token": token.Token,
		"url":   s.cfg.PublicOrigin + "/sub/" + token.Token,
	})
}

// subscriptionLinks is the admin panel's own QR-dialog data source — get
// (or mint) this client's subscription URL plus its wireturn:// deep-link
// wrapper (§4) for one-tap import into the app.
func (s *Server) subscriptionLinks(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}
	token, err := s.getOrCreateSubscriptionToken(client)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	url := s.cfg.PublicOrigin + "/sub/" + token.Token
	c.JSON(http.StatusOK, gin.H{
		"url":          url,
		"wireturnLink": buildSubscriptionWireturnLink(url),
	})
}

// exportClientProfiles is the admin panel's "скачать wt-*.json" action for
// a whole client — a bare Profile[] JSON file, the §5.4 item-2 shape the
// app's file-import screen accepts directly (JSON/ZIP, "wt_" filename
// prefix — see §4 file-import section).
func (s *Server) exportClientProfiles(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}
	profiles := make([]BundleProfile, 0, len(client.Profiles))
	for _, profile := range client.Profiles {
		profiles = append(profiles, s.buildBundleProfile(profile))
	}
	filename := "wt_" + slugFilename(client.Name) + ".json"
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.JSON(http.StatusOK, profiles)
}

// handleSubscription is the public, unauthenticated endpoint WireTurn's
// client polls. It implements the ProfileBundle schema from
// docs/subscriptions.md §5.4/§5.5, and additionally content-negotiates by
// User-Agent/?format= (not itself part of the spec — the app tries several
// parse strategies on whatever body it gets regardless — but needed so a
// plain browser opening this link gets a usable page instead of raw JSON,
// same as 3x-ui's subscription info page):
//   - ?format= wins outright when present ("json"/"text"/"base64"/"html").
//   - else "WireTurn/…" UA (the app itself) → json.
//   - else a real browser (UA contains "Mozilla") → html.
//   - else (curl, a generic subscription manager, …) → text.
func (s *Server) handleSubscription(c *gin.Context) {
	tokenStr := c.Param("token")

	var token models.SubscriptionToken
	if err := s.db.Where("token = ?", tokenStr).First(&token).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown subscription token"})
		return
	}

	var client models.Client
	if err := s.db.Preload("Profiles").First(&client, token.ClientID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	now := time.Now()
	_ = s.db.Model(&token).Update("last_accessed_at", &now)

	format := c.Query("format")
	if format == "" {
		ua := c.GetHeader("User-Agent")
		switch {
		case strings.HasPrefix(ua, "WireTurn/"):
			format = "json"
		case strings.Contains(ua, "Mozilla"):
			format = "html"
		default:
			format = "text"
		}
	}

	expired := !client.Enabled || (client.ExpiresAt != nil && client.ExpiresAt.Before(now))

	bundle := ProfileBundle{
		Version:               1,
		Name:                  client.Name,
		Description:           client.Description,
		UpdateIntervalMinutes: updateIntervalOrDefault(client.UpdateIntervalMinutes),
		BytesUsed:             client.TrafficUsedByte,
		BytesTotal:            client.TrafficLimitByte,
	}
	if !expired {
		for _, profile := range client.Profiles {
			bundle.Profiles = append(bundle.Profiles, s.buildBundleProfile(profile))
		}
		if len(bundle.Profiles) > 0 {
			bundle.RecommendedProfileID = bundle.Profiles[0].ID
		}
	}

	c.Header("Profile-Title", client.Name)
	c.Header("Subscription-Userinfo", subscriptionUserinfo(client))

	switch format {
	case "html":
		subURL := s.cfg.PublicOrigin + "/sub/" + token.Token
		s.renderSubscriptionHTML(c, client, bundle, subURL, expired)
	case "text":
		c.String(http.StatusOK, s.buildTextSubscription(client, client.TrafficUsedByte, client.TrafficLimitByte))
	case "base64":
		c.String(http.StatusOK, base64StdEncode(s.buildTextSubscription(client, client.TrafficUsedByte, client.TrafficLimitByte)))
	default:
		c.JSON(http.StatusOK, bundle)
	}
}

// buildBundleProfile resolves one Profile row into the wire-format
// BundleProfile the subscription (and the admin panel's own QR/export
// endpoints) all share, so the two can never drift apart.
func (s *Server) buildBundleProfile(profile models.Profile) BundleProfile {
	bp := BundleProfile{
		ID:          profile.ExternalID,
		Name:        profile.Name,
		URI:         profile.KernelURI,
		XrayEnabled: profile.XrayEnabled,
	}
	if profile.XrayEnabled {
		bp.XrayProtocol, bp.VlessConfig, bp.WgConfig = s.buildXrayBundleConfig(&profile)
	}
	return bp
}

// buildXrayBundleConfig resolves what a profile's xray overlay actually
// sends to the WireTurn client — a real vless://trojan://hysteria2:// link
// (vlessConfig) or a structured WireGuard peer config (wgConfig), matching
// WireTurn's docs/subscriptions.md §3 field-for-field (an earlier version
// of this sent a resolved-settings JSON blob under a made-up "xrayConfig"
// key, which no real WireTurn client can parse — see README for the
// writeup). Best-effort — a stale XrayInboundID (inbound deleted after the
// profile was created) falls back to the manual fallback (if any) rather
// than failing the whole subscription.
func (s *Server) buildXrayBundleConfig(profile *models.Profile) (protocol string, vless *VlessConfig, wg *WgConfig) {
	if profile.XrayInboundID != nil {
		var inbound models.XrayInbound
		if err := s.db.First(&inbound, *profile.XrayInboundID).Error; err == nil {
			var xc models.XrayClient
			if err := s.db.Where("inbound_id = ? AND client_id = ?", inbound.ID, profile.ClientID).First(&xc).Error; err == nil {
				if inbound.Protocol == "wireguard" {
					if priv, pub, addr, mtu, err := xray.BuildWireGuardConfig(inbound, xc); err == nil {
						return "WIREGUARD", nil, &WgConfig{PrivateKey: priv, PublicKey: pub, Address: addr, Mtu: mtu}
					}
				} else if link, err := xray.BuildClientLink(inbound, xc, profile.Name, s.cfg.PublicIP); err == nil {
					return "VLESS", s.buildVlessConfig(profile, link), nil
				}
			}
		}
	}
	if profile.XrayManualURI != "" {
		return "VLESS", s.buildVlessConfig(profile, profile.XrayManualURI), nil
	}
	if profile.XrayManualWireGuard != "" {
		priv, pub, addr, mtu := xray.ParseWireGuardConfigText(profile.XrayManualWireGuard)
		return "WIREGUARD", nil, &WgConfig{PrivateKey: priv, PublicKey: pub, Address: addr, Mtu: mtu}
	}
	return "", nil, nil
}

// buildVlessConfig folds in the Dual Route fields (§3) — these only ever
// apply to the VLESS-mode overlay, never WireGuard, which has no
// equivalent in the spec.
func (s *Server) buildVlessConfig(profile *models.Profile, link string) *VlessConfig {
	return &VlessConfig{
		VlessLink:     link,
		IsDualRoute:   profile.XrayDualRoute,
		DirectAddress: profile.XrayDirectAddress,
		HcInterval:    profile.XrayHcInterval,
		Mux:           profile.XrayMux,
	}
}

func subscriptionUserinfo(client models.Client) string {
	return "upload=0; download=" + strconv.FormatInt(client.TrafficUsedByte, 10) +
		"; total=" + strconv.FormatInt(client.TrafficLimitByte, 10)
}
