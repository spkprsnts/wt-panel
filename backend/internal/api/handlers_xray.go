package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"wtpanel/internal/models"
	"wtpanel/internal/provisioner/common"
)

type XrayInboundRequest struct {
	Protocol       string          `json:"protocol" binding:"required"`
	Remark         string          `json:"remark" binding:"required"`
	Listen         string          `json:"listen"`
	Port           int             `json:"port" binding:"required"`
	Enable         *bool           `json:"enable"`
	Settings       json.RawMessage `json:"settings"`
	StreamSettings json.RawMessage `json:"streamSettings"`
	Sniffing       json.RawMessage `json:"sniffing"`
}

// XrayClientRequest attaches an existing panel Client to an inbound. Config
// is optional — when omitted, an identity is auto-generated to match the
// inbound's protocol (see generateClientConfig). The common fields below
// mirror the ones every 3x-ui client carries regardless of protocol
// (traffic/IP limits, expiry, enable, a free-text comment) — when set they
// overlay the generated-or-existing config rather than replacing it, so
// setting a traffic limit doesn't wipe out an already-generated UUID.
type XrayClientRequest struct {
	ClientID   uint            `json:"clientId" binding:"required"`
	Config     json.RawMessage `json:"config"`
	LimitIP    *int            `json:"limitIp"`
	TotalGB    *int64          `json:"totalGB"` // bytes, despite the name — matches xray-core's own field
	ExpiryTime *int64          `json:"expiryTime"`
	Enable     *bool           `json:"enable"`
	Comment    *string         `json:"comment"`
}

func (s *Server) listXrayInbounds(c *gin.Context) {
	var inbounds []models.XrayInbound
	if err := s.db.Preload("Clients").Order("created_at desc").Find(&inbounds).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, inbounds)
}

func (s *Server) createXrayInbound(c *gin.Context) {
	var req XrayInboundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	inbound := models.XrayInbound{
		Protocol:       req.Protocol,
		Remark:         req.Remark,
		Listen:         req.Listen,
		Port:           req.Port,
		Enable:         true,
		Settings:       string(req.Settings),
		StreamSettings: string(req.StreamSettings),
		Sniffing:       string(req.Sniffing),
	}
	if req.Enable != nil {
		inbound.Enable = *req.Enable
	}
	if err := s.db.Create(&inbound).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.reloadXray(c)
	c.JSON(http.StatusCreated, inbound)
}

func (s *Server) updateXrayInbound(c *gin.Context) {
	inbound, err := s.loadXrayInbound(c)
	if err != nil {
		return
	}

	var req XrayInboundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	inbound.Remark = req.Remark
	inbound.Listen = req.Listen
	inbound.Port = req.Port
	if req.Enable != nil {
		inbound.Enable = *req.Enable
	}
	if req.Settings != nil {
		inbound.Settings = string(req.Settings)
	}
	if req.StreamSettings != nil {
		inbound.StreamSettings = string(req.StreamSettings)
	}
	if req.Sniffing != nil {
		inbound.Sniffing = string(req.Sniffing)
	}
	// Protocol is deliberately not editable here — changing it would orphan
	// every attached XrayClient's identity shape (a vless uuid isn't a
	// trojan password); delete and recreate the inbound instead.

	if err := s.db.Save(inbound).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.reloadXray(c)
	c.JSON(http.StatusOK, inbound)
}

func (s *Server) deleteXrayInbound(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid inbound id"})
		return
	}
	if err := s.db.Where("inbound_id = ?", id).Delete(&models.XrayClient{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := s.db.Delete(&models.XrayInbound{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.reloadXray(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) loadXrayInbound(c *gin.Context) (*models.XrayInbound, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid inbound id"})
		return nil, err
	}
	var inbound models.XrayInbound
	if err := s.db.First(&inbound, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "inbound not found"})
		return nil, err
	}
	return &inbound, nil
}

// listInboundClients lists the panel Clients attached to one inbound.
func (s *Server) listInboundClients(c *gin.Context) {
	inbound, err := s.loadXrayInbound(c)
	if err != nil {
		return
	}
	var clients []models.XrayClient
	if err := s.db.Where("inbound_id = ?", inbound.ID).Find(&clients).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, clients)
}

// attachXrayClient links an existing panel Client to an inbound, matching
// "no client exists on the Xray side unless it exists on the Clients page":
// this is the only way an XrayClient row is created directly by an
// operator (createProfile also creates one, but only for a real Client it
// already loaded). Config is auto-generated when omitted.
func (s *Server) attachXrayClient(c *gin.Context) {
	inbound, err := s.loadXrayInbound(c)
	if err != nil {
		return
	}

	var req XrayClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var client models.Client
	if err := s.db.First(&client, req.ClientID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return
	}

	xc, err := s.ensureXrayClient(inbound, &client, req.Config)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.LimitIP != nil || req.TotalGB != nil || req.ExpiryTime != nil || req.Enable != nil || req.Comment != nil {
		overlaid, err := overlayCommonClientFields(xc.Config, req)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		xc.Config = overlaid
		if err := s.db.Save(xc).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	s.reloadXray(c)
	c.JSON(http.StatusCreated, xc)
}

// overlayCommonClientFields sets the protocol-agnostic 3x-ui client fields
// (traffic/IP limit, expiry, enable, comment) on top of an existing config
// blob without touching its protocol-specific identity (uuid/password/auth/
// keys).
func overlayCommonClientFields(cfg string, req XrayClientRequest) (string, error) {
	var m map[string]any
	if cfg != "" {
		if err := json.Unmarshal([]byte(cfg), &m); err != nil {
			return "", err
		}
	}
	if m == nil {
		m = map[string]any{}
	}
	if req.LimitIP != nil {
		m["limitIp"] = *req.LimitIP
	}
	if req.TotalGB != nil {
		m["totalGB"] = *req.TotalGB
	}
	if req.ExpiryTime != nil {
		m["expiryTime"] = *req.ExpiryTime
	}
	if req.Enable != nil {
		m["enable"] = *req.Enable
	}
	if req.Comment != nil {
		m["comment"] = *req.Comment
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (s *Server) detachXrayClient(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("clientId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid xray client id"})
		return
	}
	if err := s.db.Delete(&models.XrayClient{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.reloadXray(c)
	c.Status(http.StatusNoContent)
}

// attachProfileToInbound is called from createProfile/updateProfile when a
// profile picks an inbound for its xray overlay — it makes sure "the
// client exists in Xray because the client exists on the Clients page"
// holds automatically, without the operator having to separately visit the
// Xray page and attach it first.
func (s *Server) attachProfileToInbound(profile *models.Profile, inboundID uint, client *models.Client) error {
	var inbound models.XrayInbound
	if err := s.db.First(&inbound, inboundID).Error; err != nil {
		return err
	}
	_, err := s.ensureXrayClient(&inbound, client, nil)
	return err
}

// ensureXrayClient finds or creates the (inbound, client) attachment row.
// Passing an explicit config overwrites an existing row's identity (used
// when an operator wants to set a specific UUID/password rather than a
// generated one); an empty config on an already-attached pair is a no-op
// that just returns the existing row, so createProfile's "attach on pick"
// path never regenerates a client's identity out from under a profile that
// already reference it.
func (s *Server) ensureXrayClient(inbound *models.XrayInbound, client *models.Client, explicitConfig json.RawMessage) (*models.XrayClient, error) {
	var xc models.XrayClient
	err := s.db.Where("inbound_id = ? AND client_id = ?", inbound.ID, client.ID).First(&xc).Error
	switch {
	case err == nil:
		if len(explicitConfig) > 0 {
			xc.Config = string(explicitConfig)
			if saveErr := s.db.Save(&xc).Error; saveErr != nil {
				return nil, saveErr
			}
		}
		return &xc, nil
	default:
		cfg := string(explicitConfig)
		if cfg == "" {
			generated, genErr := generateClientConfig(inbound.Protocol, client.Name)
			if genErr != nil {
				return nil, genErr
			}
			cfg = generated
		}
		xc = models.XrayClient{InboundID: inbound.ID, ClientID: client.ID, Config: cfg, Enable: true}
		if createErr := s.db.Create(&xc).Error; createErr != nil {
			return nil, createErr
		}
		return &xc, nil
	}
}

// generateClientConfig produces a fresh per-client identity matching the
// inbound's protocol — the same shapes the "Сгенерировать" buttons in the
// Xray page produce, just called server-side so attaching a client never
// requires a round-trip through the keygen endpoints first. Every protocol
// also gets the same common 3x-ui client fields (limitIp/totalGB/
// expiryTime/enable/subId/comment/reset/tgId) so a freshly attached client
// round-trips through the same shape a real xray-core client list expects,
// not just an identity.
func generateClientConfig(protocol, clientName string) (string, error) {
	identity, err := generateClientIdentity(protocol)
	if err != nil {
		return "", err
	}
	identity["email"] = clientName
	identity["limitIp"] = 0
	identity["totalGB"] = int64(0)
	identity["expiryTime"] = int64(0)
	identity["enable"] = true
	identity["subId"] = ""
	identity["comment"] = ""
	identity["reset"] = 0
	identity["tgId"] = 0
	return marshalClientConfig(identity)
}

// generateClientIdentity returns just the protocol-specific identity
// fields — hysteria2's field is "auth" (a token), not "password" like
// trojan, even though both are generated the same way (a random hex
// secret); vless is a uuid+flow, wireguard a real X25519 keypair.
func generateClientIdentity(protocol string) (map[string]any, error) {
	switch protocol {
	case "vless":
		// xray-core's own field name is "id", not "uuid" — confirmed by
		// running a real xray-core binary against a generated config: it
		// silently treats a "uuid" key as absent, defaults to "", and fails
		// with "invalid UUID: " (empty) at startup. Caught via the real
		// binary, not by inspection — see README for the incident.
		return map[string]any{"id": uuid.New().String(), "flow": ""}, nil
	case "trojan":
		password, err := common.RandomHexKey(16)
		if err != nil {
			return nil, err
		}
		return map[string]any{"password": password}, nil
	case "hysteria2":
		auth, err := common.RandomHexKey(16)
		if err != nil {
			return nil, err
		}
		return map[string]any{"auth": auth}, nil
	case "wireguard":
		priv, pub, err := common.GenerateWireGuardKeypair()
		if err != nil {
			return nil, err
		}
		return map[string]any{"privateKey": priv, "publicKey": pub}, nil
	default:
		return map[string]any{}, nil
	}
}

func marshalClientConfig(v map[string]any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// reloadXray regenerates xray-core's config from the DB and starts/
// restarts/stops the process to match — called after every mutation to an
// XrayInbound or XrayClient. Best-effort like teardownProfile: the DB write
// already succeeded and is the source of truth, so a process hiccup here
// (e.g. xray-core not installed yet) shouldn't fail the whole request, just
// get logged via gin's error collector.
func (s *Server) reloadXray(c *gin.Context) {
	if s.xrayMgr == nil {
		return
	}
	if err := s.xrayMgr.Reload(); err != nil {
		c.Error(fmt.Errorf("xray-core reload: %w", err))
	}
}

func (s *Server) getXrayStatus(c *gin.Context) {
	if s.xrayMgr == nil {
		c.JSON(http.StatusOK, gin.H{"running": false, "pid": 0})
		return
	}
	running, pid := s.xrayMgr.Status()
	c.JSON(http.StatusOK, gin.H{"running": running, "pid": pid})
}

func (s *Server) getXrayLogs(c *gin.Context) {
	if s.xrayMgr == nil {
		c.JSON(http.StatusOK, gin.H{"log": ""})
		return
	}
	maxBytes := 64 * 1024
	if tail := c.Query("tail"); tail != "" {
		if n, err := strconv.Atoi(tail); err == nil && n > 0 {
			maxBytes = n
		}
	}
	log, err := s.xrayMgr.Logs(maxBytes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"log": log})
}
