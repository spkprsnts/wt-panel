package api

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"wtpanel/internal/auth"
	"wtpanel/internal/config"
	"wtpanel/internal/kernels"
	"wtpanel/internal/provisioner"
	"wtpanel/internal/webui"
	"wtpanel/internal/xray"
)

type Server struct {
	db           *gorm.DB
	cfg          *config.Config
	authSvc      *auth.Service
	loginLimiter *auth.LoginLimiter
	registry     *provisioner.Registry
	jobs         *kernels.JobManager
	// restartCh signals main()'s select loop to restart the panel; buffered so the handler never blocks.
	restartCh chan<- struct{}
	// xrayMgr owns the shared xray-core process; mutating handlers call xrayMgr.Reload() afterwards (see reloadXray).
	xrayMgr *xray.Manager
	// version is main.version, baked in at build time (see .goreleaser.yaml); surfaced via getSettings.
	version string
	// bootID is a fresh random ID per process, exposed via getSettings so the Settings page's restart/update
	// dialogs can detect a new process is serving requests — plain reachability polling can miss the down-window.
	bootID string
}

// generateBootID returns a fresh random hex string identifying this process instance.
func generateBootID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}

func New(db *gorm.DB, cfg *config.Config, authSvc *auth.Service, registry *provisioner.Registry, restartCh chan<- struct{}, basePath string, xrayMgr *xray.Manager, version string) *gin.Engine {
	s := &Server{db: db, cfg: cfg, authSvc: authSvc, loginLimiter: auth.NewLoginLimiter(), registry: registry, jobs: kernels.NewJobManager(), restartCh: restartCh, xrayMgr: xrayMgr, version: version, bootID: generateBootID()}

	r := gin.Default()

	// Admin panel, never meant to be crawled/indexed; covers every response including the JSON API.
	r.Use(func(c *gin.Context) {
		c.Header("X-Robots-Tag", "noindex, nofollow, noarchive")
		c.Next()
	})

	r.POST("/api/login", s.handleLogin)
	r.GET("/sub/:token", s.handleSubscription)

	authorized := r.Group("/api")
	authorized.Use(authSvc.Middleware())
	{
		authorized.GET("/clients", s.listClients)
		authorized.POST("/clients", s.createClient)
		authorized.GET("/clients/:id", s.getClient)
		authorized.PUT("/clients/:id", s.updateClient)
		authorized.DELETE("/clients/:id", s.deleteClient)

		authorized.POST("/clients/:id/profiles", s.createProfile)
		authorized.PUT("/clients/:id/profiles/reorder", s.reorderProfiles)
		authorized.PUT("/profiles/:id", s.updateProfile)
		authorized.DELETE("/profiles/:id", s.deleteProfile)
		authorized.GET("/profiles/:id/logs", s.getProfileLogs)
		authorized.POST("/profiles/:id/restart", s.restartProfile)
		authorized.PUT("/profiles/:id/recommend", s.setProfileRecommended)
		authorized.GET("/profiles/:id/links", s.profileLinks)
		authorized.GET("/profiles/:id/export", s.exportProfile)

		authorized.POST("/clients/:id/subscription-token", s.createSubscriptionToken)
		authorized.GET("/clients/:id/subscription-links", s.subscriptionLinks)
		authorized.GET("/clients/:id/export", s.exportClientProfiles)

		authorized.POST("/keygen/turnable", s.keygenTurnable)
		authorized.POST("/keygen/hex32", s.keygenHex32)
		authorized.POST("/keygen/wireguard", s.keygenWireGuard)

		authorized.GET("/kernels", s.listKernels)
		authorized.GET("/kernels/turnable/releases", s.listTurnableReleases)
		authorized.POST("/kernels/turnable/install", s.installTurnable)
		authorized.GET("/kernels/freeturn/releases", s.listFreeTurnReleases)
		authorized.POST("/kernels/freeturn/install", s.installFreeTurn)
		authorized.GET("/kernels/olcrtc/commits", s.listOlcrtcCommits)
		authorized.POST("/kernels/olcrtc/build", s.buildOlcrtc)
		authorized.GET("/kernels/xray/releases", s.listXrayReleases)
		authorized.POST("/kernels/xray/install", s.installXray)
		authorized.GET("/kernels/webdav/releases", s.listWebDAVReleases)
		authorized.POST("/kernels/webdav/install", s.installWebDAV)
		// Job status is keyed by kernel name (not a job id) so the frontend can poll after a reload
		// without having remembered anything — see getKernelJob.
		authorized.GET("/kernels/job/:name", s.getKernelJob)

		authorized.GET("/rooms", s.listCallRooms)
		authorized.POST("/rooms", s.createCallRoom)
		authorized.PUT("/rooms/:id", s.updateCallRoom)
		authorized.DELETE("/rooms/:id", s.deleteCallRoom)

		authorized.GET("/xray/inbounds", s.listXrayInbounds)
		authorized.POST("/xray/inbounds", s.createXrayInbound)
		authorized.PUT("/xray/inbounds/:id", s.updateXrayInbound)
		authorized.DELETE("/xray/inbounds/:id", s.deleteXrayInbound)
		authorized.GET("/xray/inbounds/:id/clients", s.listInboundClients)
		authorized.POST("/xray/inbounds/:id/clients", s.attachXrayClient)
		authorized.DELETE("/xray/clients/:clientId", s.detachXrayClient)

		authorized.POST("/keygen/reality", s.keygenReality)
		authorized.POST("/keygen/short-ids", s.keygenShortIds)

		authorized.GET("/xray/status", s.getXrayStatus)
		authorized.GET("/xray/logs", s.getXrayLogs)

		authorized.GET("/system/stats", s.getSystemStats)

		authorized.GET("/account", s.getAccount)
		authorized.PUT("/account/password", s.changePassword)
		authorized.POST("/account/totp/setup", s.startTotpSetup)
		authorized.POST("/account/totp/confirm", s.confirmTotpSetup)
		authorized.POST("/account/totp/disable", s.disableTotp)
		authorized.GET("/settings", s.getSettings)
		authorized.GET("/settings/panel", s.getPanelSettings)
		authorized.PUT("/settings/panel", s.updatePanelSettings)
		authorized.POST("/settings/panel/restart", s.restartPanel)
		authorized.GET("/settings/panel/update-check", s.checkPanelUpdate)
		authorized.POST("/settings/panel/update", s.updatePanel)
		authorized.GET("/settings/panel/backup", s.downloadPanelBackup)
		authorized.POST("/settings/panel/restore", s.restorePanelBackup)
	}

	serveWebUI(r, basePath)

	return r
}

// serveWebUI serves the embedded frontend build for every request that isn't an API/subscription
// route: unmatched /api or /sub paths stay a real 404, everything else falls back to index.html so
// client-side (react-router-dom) routes survive a hard refresh. index.html is patched at startup
// with a window.__WTP_BASE_PATH__ assignment right after <head> — since routes here run stripped of
// the base path, the SPA (BrowserRouter basename, lib/api.ts fetch calls) reads this global to
// prepend the real prefix back onto root-absolute paths like "/api/login".
func serveWebUI(r *gin.Engine, basePath string) {
	dist, err := webui.DistFS()
	if err != nil {
		log.Printf("webui: embedded frontend unavailable: %v", err)
		return
	}
	fileServer := http.FileServer(http.FS(dist))

	indexHTML, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		log.Printf("webui: index.html missing from embedded frontend: %v", err)
		return
	}
	injection := []byte("<head>\n<script>window.__WTP_BASE_PATH__=" + strconv.Quote(basePath) + ";</script>")
	indexHTML = bytes.Replace(indexHTML, []byte("<head>"), injection, 1)

	serveIndex := func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	}

	r.NoRoute(func(c *gin.Context) {
		reqPath := strings.TrimPrefix(c.Request.URL.Path, "/")
		if strings.HasPrefix(c.Request.URL.Path, "/api") || strings.HasPrefix(c.Request.URL.Path, "/sub") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if reqPath != "" && reqPath != "index.html" {
			if info, statErr := fs.Stat(dist, reqPath); statErr == nil && !info.IsDir() {
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
		}
		serveIndex(c)
	})
}
