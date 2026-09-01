package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/sysstat"
)

// getSystemStats reports host CPU/RAM/disk usage for the Dashboard page — disk usage is for the
// panel's data directory, not necessarily the OS's own filesystem.
func (s *Server) getSystemStats(c *gin.Context) {
	stats, err := sysstat.Collect(s.cfg.DataDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}
