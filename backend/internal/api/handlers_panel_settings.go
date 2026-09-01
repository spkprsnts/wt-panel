package api

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/kernels"
	"wtpanel/internal/models"
)

// getPanelSettings returns the panel's own network/TLS settings, the editable counterpart to
// getSettings' read-only env dump. Assumes the singleton row (id 1) exists — see db.seedPanelSettings.
func (s *Server) getPanelSettings(c *gin.Context) {
	var ps models.PanelSettings
	if err := s.db.First(&ps, 1).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ps)
}

type panelSettingsRequest struct {
	ListenIP         string `json:"listenIp"`
	ListenDomain     string `json:"listenDomain"`
	ListenPort       int    `json:"listenPort"`
	BasePath         string `json:"basePath" binding:"required"`
	TLSCertFile      string `json:"tlsCertFile"`
	TLSKeyFile       string `json:"tlsKeyFile"`
	PublicIP         string `json:"publicIp"`
	WebDAVPublicHost string `json:"webdavPublicHost"`
}

// updatePanelSettings persists the new network/TLS settings but doesn't apply them to the running
// process — main.go only reads this row once at startup — so the response carries restartRequired.
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
	ps.WebDAVPublicHost = req.WebDAVPublicHost
	if err := s.db.Save(&ps).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": ps, "restartRequired": true})
}

// restartPanel triggers a real self-restart: main.go relaunches the same binary (re-reading
// PanelSettings and config) and gracefully tears this one down; kernel processes come back once the
// new process's registry.RestoreAll runs, so the interruption is real but brief. The signal is sent
// after a short delay, once the response is already written, so the client gets its confirmation
// instead of the connection dying mid-request.
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

// checkPanelUpdate looks up the newest wt-panel GitHub Release (force=true bypasses ListReleases'
// 10-minute cache, since this is an explicit, infrequent action) and compares its tag against
// s.version, TrimPrefix-ing the release's "vX.Y.Z" to match goreleaser's unprefixed {{.Version}}.
// updateAvailable is always false for a "dev" build.
func (s *Server) checkPanelUpdate(c *gin.Context) {
	releases, err := kernels.ListReleases("spkprsnts", "wt-panel", 1, true)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if len(releases) == 0 {
		c.JSON(http.StatusOK, gin.H{"currentVersion": s.version, "latestVersion": "", "updateAvailable": false})
		return
	}

	latest := strings.TrimPrefix(releases[0].TagName, "v")
	updateAvailable := s.version != "dev" && latest != "" && latest != s.version
	c.JSON(http.StatusOK, gin.H{
		"currentVersion":  s.version,
		"latestVersion":   latest,
		"updateAvailable": updateAvailable,
	})
}

// updatePanel downloads the newest wt-panel release, swaps it in, then triggers the same
// self-restart restartPanel does. Safe to overwrite the running executable's path: the download
// targets a ".new" file first, and even the rename doesn't disturb this process — Linux keeps a
// running executable's old inode open until it exits, so the swap only affects the next process
// started from that path (relaunchSelf).
func (s *Server) updatePanel(c *gin.Context) {
	if s.version == "dev" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "обновление недоступно для сборки из исходников (dev)"})
		return
	}

	exe, err := os.Executable()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	newExe := exe + ".new"
	assetSuffix := fmt.Sprintf("-linux-%s.tar.gz", runtime.GOARCH)
	installedVersion, err := kernels.InstallReleaseTarGzEntry("spkprsnts", "wt-panel", "", assetSuffix, "wt-panel", newExe)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if err := os.Chmod(newExe, 0o755); err != nil {
		os.Remove(newExe)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := os.Rename(newExe, exe); err != nil {
		os.Remove(newExe)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"updating": true, "version": strings.TrimPrefix(installedVersion, "v")})
	go func() {
		time.Sleep(300 * time.Millisecond)
		select {
		case s.restartCh <- struct{}{}:
		default:
		}
	}()
}
