package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/auth"
	"wtpanel/internal/models"
)

// startTotpSetup generates a fresh secret + otpauth:// QR for the Settings
// page's "Enable 2FA" dialog. Deliberately NOT persisted here — only
// confirmTotpSetup, after seeing a real passing code, writes it to the
// AdminUser row — so a QR the admin fails to scan (or a dialog they close
// without finishing) never leaves 2FA half-configured against a secret
// they don't actually have loaded in their authenticator app.
func (s *Server) startTotpSetup(c *gin.Context) {
	adminID := c.MustGet("admin_id").(uint)
	var admin models.AdminUser
	if err := s.db.First(&admin, adminID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "account not found"})
		return
	}
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	uri := auth.BuildTOTPURI("wt-panel", admin.Username, secret)
	c.JSON(http.StatusOK, gin.H{
		"secret":    secret,
		"qrDataUri": qrDataURI(uri),
	})
}

type confirmTotpRequest struct {
	Secret string `json:"secret" binding:"required"`
	Code   string `json:"code" binding:"required"`
}

// confirmTotpSetup is the second half of startTotpSetup: only once the
// operator proves they can actually generate a valid code from the secret
// they were just shown does it get saved as this admin's real 2FA secret.
func (s *Server) confirmTotpSetup(c *gin.Context) {
	var req confirmTotpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !auth.ValidateTOTPCode(req.Secret, req.Code) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid code — check your authenticator app and try again"})
		return
	}
	adminID := c.MustGet("admin_id").(uint)
	if err := s.db.Model(&models.AdminUser{}).Where("id = ?", adminID).Update("totp_secret", req.Secret).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

type totpCodeRequest struct {
	Code string `json:"code" binding:"required"`
}

// disableTotp requires one more valid code (proof the admin still holds
// the device) rather than just being logged in — losing the authenticator
// app shouldn't be a one-click way for whoever's holding a stolen bearer
// token to also strip 2FA off the account.
func (s *Server) disableTotp(c *gin.Context) {
	var req totpCodeRequest
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
	if admin.TOTPSecret == "" {
		c.Status(http.StatusNoContent)
		return
	}
	if !auth.ValidateTOTPCode(admin.TOTPSecret, req.Code) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid code"})
		return
	}
	admin.TOTPSecret = ""
	if err := s.db.Save(&admin).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
