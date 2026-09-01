package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"wtpanel/internal/models"
)

// orderProfilesBySortOrder is shared by every Preload("Profiles", ...) below
// so a client's profiles always come back in their saved display order (see
// models.Profile.SortOrder) rather than GORM's default primary-key order —
// ties (existing rows predating this field, all SortOrder 0) fall back to id,
// which matches their original creation order anyway.
func orderProfilesBySortOrder(db *gorm.DB) *gorm.DB {
	return db.Order("sort_order, id")
}

func (s *Server) listClients(c *gin.Context) {
	var clients []models.Client
	if err := s.db.Preload("Profiles", orderProfilesBySortOrder).Preload("Profiles.XrayInbound").Find(&clients).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for i := range clients {
		for j := range clients[i].Profiles {
			s.registry.FillStatus(&clients[i].Profiles[j])
		}
	}
	c.JSON(http.StatusOK, clients)
}

func (s *Server) createClient(c *gin.Context) {
	var req ClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client := models.Client{
		Name:                  req.Name,
		Enabled:               true,
		TrafficLimitByte:      req.TrafficLimitByte,
		Description:           req.Description,
		UpdateIntervalMinutes: updateIntervalOrDefault(req.UpdateIntervalMinutes),
	}
	if req.Enabled != nil {
		client.Enabled = *req.Enabled
	}
	if req.ExpiresAt != nil {
		t := time.Unix(*req.ExpiresAt, 0)
		client.ExpiresAt = &t
	}

	if err := s.db.Create(&client).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, client)
}

func (s *Server) getClient(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}
	c.JSON(http.StatusOK, client)
}

func (s *Server) updateClient(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}

	var req ClientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client.Name = req.Name
	client.TrafficLimitByte = req.TrafficLimitByte
	client.Description = req.Description
	client.UpdateIntervalMinutes = updateIntervalOrDefault(req.UpdateIntervalMinutes)
	if req.Enabled != nil {
		client.Enabled = *req.Enabled
	}
	if req.ExpiresAt != nil {
		t := time.Unix(*req.ExpiresAt, 0)
		client.ExpiresAt = &t
	} else {
		client.ExpiresAt = nil
	}

	if err := s.db.Save(client).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, client)
}

func (s *Server) deleteClient(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}

	var profiles []models.Profile
	if err := s.db.Where("client_id = ?", client.ID).Find(&profiles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for _, profile := range profiles {
		s.teardownProfile(c, &profile)
	}

	if err := s.db.Select("Profiles", "SubscriptionTokens", "XrayClients").Delete(client).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// updateIntervalOrDefault falls back to the spec's own default (§5.4
// "updateIntervalMinutes") whenever the request left it unset/zero — 0
// would otherwise tell a real WireTurn client to poll nonstop.
func updateIntervalOrDefault(minutes int) int {
	if minutes <= 0 {
		return 60
	}
	return minutes
}

func (s *Server) loadClient(c *gin.Context) (*models.Client, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid client id"})
		return nil, err
	}
	var client models.Client
	if err := s.db.Preload("Profiles", orderProfilesBySortOrder).Preload("Profiles.XrayInbound").First(&client, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "client not found"})
		return nil, err
	}
	for i := range client.Profiles {
		s.registry.FillStatus(&client.Profiles[i])
	}
	return &client, nil
}
