package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/models"
)

// getPanelSettings returns the panel's own network/TLS settings — the
// editable counterpart to getSettings' read-only env dump. Assumes the
// singleton row (id 1) exists — seeded at startup, see db.seedPanelSettings.
func (s *Server) getPanelSettings(c *gin.Context) {
	var ps models.PanelSettings
	if err := s.db.First(&ps, 1).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ps)
}

type panelSettingsRequest struct {
	ListenIP     string `json:"listenIp"`
	ListenDomain string `json:"listenDomain"`
	ListenPort   int    `json:"listenPort"`
	BasePath     string `json:"basePath" binding:"required"`
	TLSCertFile  string `json:"tlsCertFile"`
	TLSKeyFile   string `json:"tlsKeyFile"`
	PublicIP     string `json:"publicIp"`
}

// updatePanelSettings persists the new network/TLS settings but — same as
// 3x-ui's own panel settings — doesn't apply them to the running process:
// main.go only reads this row once at startup to build the http.Server, so
// the response always carries restartRequired so the frontend can say so.
func (s *Server) updatePanelSettings(c *gin.Context) {
	var req panelSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !strings.HasPrefix(req.BasePath, "/") || !strings.HasSuffix(req.BasePath, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "URI-путь должен начинаться и заканчиваться на '/'"})
		return
	}

	var ps models.PanelSettings
	if err := s.db.First(&ps, 1).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ps.ListenIP = req.ListenIP
	ps.ListenDomain = req.ListenDomain
	ps.ListenPort = req.ListenPort
	ps.BasePath = req.BasePath
	ps.TLSCertFile = req.TLSCertFile
	ps.TLSKeyFile = req.TLSKeyFile
	ps.PublicIP = req.PublicIP
	if err := s.db.Save(&ps).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": ps, "restartRequired": true})
}

// restartPanel triggers a real self-restart: main.go relaunches the same
// binary (a fresh process re-reads PanelSettings and every other config
// value) and gracefully shuts down this one — same SIGTERM-based teardown
// as a manual stop, so every kernel process gets a real chance to clean up
// rather than being hard-killed. Kernel processes come back on their own
// once the new process's registry.RestoreAll runs (see main.go), so the
// interruption to any active tunnel is real but brief, not a config change
// an operator has to separately go fix.
//
// The response is written and this handler returns before the restart
// signal is sent (via a short delay in a goroutine) so the client actually
// receives the "restarting" confirmation instead of the connection just
// dying mid-request.
func (s *Server) restartPanel(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"restarting": true})
	go func() {
		time.Sleep(300 * time.Millisecond)
		select {
		case s.restartCh <- struct{}{}:
		default:
		}
	}()
}
