package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"wtpanel/internal/models"
)

func (s *Server) getAccount(c *gin.Context) {
	adminID := c.MustGet("admin_id").(uint)
	var admin models.AdminUser
	if err := s.db.First(&admin, adminID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": admin.Username})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" binding:"required"`
	NewPassword     string `json:"newPassword" binding:"required,min=8"`
}

func (s *Server) changePassword(c *gin.Context) {
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	adminID := c.MustGet("admin_id").(uint)
	var admin models.AdminUser
	if err := s.db.First(&admin, adminID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "current password is incorrect"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	admin.PasswordHash = string(hash)
	if err := s.db.Save(&admin).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// getSettings exposes the panel's current (env-var-derived) configuration
// as a read-only view for the Settings page — none of this is editable at
// runtime yet, since config.Config is loaded once at startup; changing any
// of it means setting the corresponding WTP_* env var and restarting. No
// secrets (JWT secret, kernel key material) are included here.
func (s *Server) getSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"listenAddr":   s.cfg.ListenAddr,
		"publicOrigin": s.cfg.PublicOrigin,
		"publicIP":     s.cfg.PublicIP,
		"dataDir":      s.cfg.DataDir,

		"turnableBinPath": s.cfg.TurnableBinPath,
		"olcrtcBinPath":   s.cfg.OlcRTCBinPath,
		"webdavBinPath":   s.cfg.WebDAVBinPath,
		"freeturnBinPath": s.cfg.FreeTurnBinPath,

		"turnableListenHost": s.cfg.TurnableListenHost,
		"freeturnListenHost": s.cfg.FreeTurnListenHost,
		"webdavListenHost":   s.cfg.WebDAVListenHost,

		"turnableDefaultRouteHost":   s.cfg.TurnableDefaultRouteHost,
		"freeturnDefaultConnectHost": s.cfg.FreeTurnDefaultConnectHost,
		"webdavDefaultProxyUpstream": s.cfg.WebDAVDefaultProxyUpstream,

		"webdavPublicHost": s.cfg.ResolvedWebDAVPublicHost(),
	})
}
