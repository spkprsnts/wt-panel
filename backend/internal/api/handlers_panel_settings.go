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
	ListenIP         string `json:"listenIp"`
	ListenDomain     string `json:"listenDomain"`
	ListenPort       int    `json:"listenPort"`
	BasePath         string `json:"basePath" binding:"required"`
	TLSCertFile      string `json:"tlsCertFile"`
	TLSKeyFile       string `json:"tlsKeyFile"`
	PublicIP         string `json:"publicIp"`
	WebDAVPublicHost string `json:"webdavPublicHost"`
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
	ps.WebDAVPublicHost = req.WebDAVPublicHost
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

// checkPanelUpdate looks up the newest wt-panel GitHub Release (force=true:
// this is an explicit, infrequent operator action, not a page-load path, so
// it should always hit GitHub fresh rather than serve ListReleases' own
// 10-minute cache) and compares its tag against s.version. Release tags are
// created as "vX.Y.Z" (release.yml's `git tag -a v$VERSION`), while
// s.version itself is baked in without the "v" (.goreleaser.yaml's ldflags
// use goreleaser's {{.Version}}, which is the tag with "v" already
// stripped) — TrimPrefix here just undoes that same convention so the two
// strings are comparable. updateAvailable is always false for a "dev"
// build (a plain `go build`/`go run`, not a real release binary — nothing
// on GitHub to meaningfully compare it against, let alone overwrite it
// with).
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

// updatePanel downloads the newest wt-panel release and swaps it in for the
// currently-running binary, then triggers the same self-restart mechanism
// restartPanel does. Safe to overwrite the running executable's path
// directly: DownloadBinary/os.Rename here target a ".new" file first and
// only rename it over the real path once the download fully succeeds, and
// even the rename itself doesn't disturb this already-running process —
// Linux keeps a running executable's old inode open until it exits, so the
// swap only affects the NEXT process started from that path, which is
// exactly the relaunchSelf that follows.
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
