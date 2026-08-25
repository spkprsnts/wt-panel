package api

import (
	"net"
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"wtpanel/internal/auth"
	"wtpanel/internal/models"
)

// loginClientAddr identifies the caller for the login lockout by the real
// TCP peer address (RemoteAddr), not gin's own ClientIP() — this engine
// trusts every proxy by default (see server.go: New never calls
// SetTrustedProxies), which makes ClientIP() honor an X-Forwarded-For
// header from anyone, proxy or not. Using that here would let an attacker
// bypass the whole lockout just by sending a different header on every
// request. The tradeoff: behind a real reverse proxy (nginx — see
// SettingsPage's insecure-connection note), every visitor shares the
// proxy's own address, so one attacker tripping the lockout also locks out
// every legitimate admin behind that proxy. Failing closed (spoofable) is
// worse than failing safe (occasionally over-broad) for the common case
// this panel actually ships in — install.sh sets up no reverse proxy by
// default — so that's the tradeoff taken here.
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
			// Password was correct — tell the frontend to show the code
			// step. Not itself a wrong guess, so it doesn't count toward
			// the lockout; only an actually-wrong code below does.
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
