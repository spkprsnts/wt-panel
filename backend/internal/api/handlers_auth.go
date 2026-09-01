package api

import (
	"net"
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"wtpanel/internal/auth"
	"wtpanel/internal/models"
)

// loginClientAddr identifies the caller for the login lockout by the real TCP peer address
// (RemoteAddr), not gin's ClientIP() — this engine trusts every proxy by default (no
// SetTrustedProxies call), so ClientIP() would honor an attacker-spoofed X-Forwarded-For and let
// them bypass the lockout entirely. Behind a real reverse proxy this makes every visitor share one
// address (one attacker can lock out every admin), but install.sh ships with no reverse proxy by
// default, so failing safe-but-over-broad beats failing spoofable.
func loginClientAddr(c *gin.Context) string {
	addr := c.Request.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

func (s *Server) handleLogin(c *gin.Context) {
	addr := loginClientAddr(c)
	if s.loginLimiter.Locked(addr) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many failed login attempts — try again later"})
		return
	}

	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var admin models.AdminUser
	if err := s.db.Where("username = ?", req.Username).First(&admin).Error; err != nil {
		s.loginLimiter.RecordFailure(addr)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)); err != nil {
		s.loginLimiter.RecordFailure(addr)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if admin.TOTPSecret != "" {
		if req.Code == "" {
			// Not a wrong guess, so it doesn't count toward the lockout — tells the frontend to show the code step.
			c.JSON(http.StatusUnauthorized, gin.H{"error": "totp_required"})
			return
		}
		if !auth.ValidateTOTPCode(admin.TOTPSecret, req.Code) {
			s.loginLimiter.RecordFailure(addr)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
	}

	token, err := s.authSvc.IssueToken(admin.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}
	s.loginLimiter.RecordSuccess(addr)
	c.JSON(http.StatusOK, LoginResponse{Token: token})
}
