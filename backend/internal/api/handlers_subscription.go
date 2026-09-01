package api

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/models"
	"wtpanel/internal/xray"
)

// subscriptionOrigin resolves the "scheme://host:port" to embed in subscription links, derived from
// PanelSettings rather than the unset s.cfg.PublicOrigin (which used to leak
// "http://localhost:8090/sub/..." links no client device could reach). The TLS cert is issued for
// ListenDomain, not the bare PublicIP, so the domain only wins when both a cert and ListenDomain are
// configured — never a mix reporting https for a host the cert doesn't cover.
func (s *Server) subscriptionOrigin() string {
	var ps models.PanelSettings
	if err := s.db.First(&ps, 1).Error; err != nil {
		return s.cfg.PublicOrigin
	}

	hasCert := ps.TLSCertFile != "" && ps.TLSKeyFile != ""
	scheme := "http"
	if hasCert {
		scheme = "https"
	}

	host := ps.PublicIP
	if hasCert && ps.ListenDomain != "" {
		host = ps.ListenDomain
	}
	if host == "" {
		return s.cfg.PublicOrigin
	}

	port := ps.ListenPort
	if port == 0 {
		if _, portStr, err := net.SplitHostPort(s.cfg.ListenAddr); err == nil {
			port, _ = strconv.Atoi(portStr)
		}
	}
	portSuffix := ""
	if port != 0 {
		portSuffix = fmt.Sprintf(":%d", port)
	}
	return fmt.Sprintf("%s://%s%s", scheme, host, portSuffix)
}

// getOrCreateSubscriptionToken reuses a client's existing token — repeated calls (e.g. re-opening
// the QR dialog) must not mint a fresh, independently-valid token each time.
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

	url := s.subscriptionOrigin() + "/sub/" + token.Token
	c.JSON(http.StatusCreated, gin.H{
		"token": token.Token,
		"url":   url,
	})
}

// subscriptionLinks is the QR-dialog data source — this client's subscription URL plus its
// wireturn:// deep-link wrapper (§4).
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
	url := s.subscriptionOrigin() + "/sub/" + token.Token
	resp := gin.H{
		"url":          url,
		"wireturnLink": buildSubscriptionWireturnLink(url),
	}
	c.JSON(http.StatusOK, resp)
}

// exportClientProfiles is the "download wt-*.json" action for a whole client — a bare Profile[]
// JSON file, the §5.4 item-2 shape the app's file-import screen accepts directly.
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

// handleSubscription is the public, unauthenticated endpoint WireTurn's client polls, implementing
// the ProfileBundle schema from docs/subscriptions.md §5.4/§5.5. It also content-negotiates by
// User-Agent/?format= (not part of the spec, but needed so a plain browser gets a page instead of
// raw JSON): ?format= wins if present ("json"/"text"/"base64"/"html"); else "WireTurn/…" UA → json;
// else a browser (UA contains "Mozilla") → html; else → text.
func (s *Server) handleSubscription(c *gin.Context) {
	tokenStr := c.Param("token")

	var token models.SubscriptionToken
	if err := s.db.Where("token = ?", tokenStr).First(&token).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown subscription token"})
		return
	}

	var client models.Client
	if err := s.db.Preload("Profiles", orderProfilesBySortOrder).First(&client, token.ClientID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}
	// A disabled profile's KernelURI is dead (no process running), so it's dropped here once, before
	// any format branch below sees client.Profiles.
	enabledProfiles := make([]models.Profile, 0, len(client.Profiles))
	for _, p := range client.Profiles {
		if p.Enabled {
			enabledProfiles = append(enabledProfiles, p)
		}
	}
	client.Profiles = enabledProfiles

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
		bundle.RecommendedProfileID = recommendedProfileID(client.Profiles)
	}

	c.Header("Profile-Title", client.Name)
	c.Header("Subscription-Userinfo", subscriptionUserinfo(client))

	switch format {
	case "html":
		subURL := s.subscriptionOrigin() + "/sub/" + token.Token
		s.renderSubscriptionHTML(c, client, bundle, subURL, expired)
	case "text":
		c.String(http.StatusOK, s.buildTextSubscription(client, client.TrafficUsedByte, client.TrafficLimitByte))
	case "base64":
		c.String(http.StatusOK, base64StdEncode(s.buildTextSubscription(client, client.TrafficUsedByte, client.TrafficLimitByte)))
	default:
		c.JSON(http.StatusOK, bundle)
	}
}

// recommendedProfileID picks the client's explicitly Recommended profile,
// else falls back to the first in (already sorted) list order.
func recommendedProfileID(profiles []models.Profile) string {
	for _, p := range profiles {
		if p.Recommended {
			return p.ExternalID
		}
	}
	if len(profiles) > 0 {
		return profiles[0].ExternalID
	}
	return ""
}

// buildBundleProfile resolves one Profile row into the wire-format BundleProfile shared by the
// subscription and the QR/export endpoints, so they can never drift apart.
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

// buildXrayBundleConfig resolves a profile's xray overlay to a vless://trojan://hysteria2:// link
// (vlessConfig) or a WireGuard peer config (wgConfig), matching §3 field-for-field. Best-effort: a
// stale XrayInboundID falls back to the manual URI/WireGuard fields rather than failing the subscription.
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

// buildVlessConfig folds in the Dual Route fields (§3) — VLESS-mode only, no WireGuard equivalent.
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
