package api

import (
	"bytes"
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
	db       *gorm.DB
	cfg      *config.Config
	authSvc  *auth.Service
	registry *provisioner.Registry
	jobs     *kernels.JobManager
	// restartCh is how the "Перезапустить панель" button reaches main()'s
	// select loop — see restartPanel and main.go's relaunchSelf. Buffered
	// so the handler's send never blocks even if main hasn't picked a
	// previous request off it yet.
	restartCh chan<- struct{}
	// xrayMgr owns the single shared xray-core process — every handler that
	// mutates an XrayInbound or XrayClient calls xrayMgr.Reload() afterwards
	// (best-effort — see reloadXray) so the running process always matches
	// the DB, without the operator needing a separate "apply" step.
	xrayMgr *xray.Manager
	// version is main.version, baked in at build time by .goreleaser.yaml's
	// ldflags ("dev" for a plain `go build`/`go run`) — surfaced read-only
	// via getSettings, same as every other build-time value there.
	version string
}

func New(db *gorm.DB, cfg *config.Config, authSvc *auth.Service, registry *provisioner.Registry, restartCh chan<- struct{}, basePath string, xrayMgr *xray.Manager, version string) *gin.Engine {
	s := &Server{db: db, cfg: cfg, authSvc: authSvc, registry: registry, jobs: kernels.NewJobManager(), restartCh: restartCh, xrayMgr: xrayMgr, version: version}

	r := gin.Default()

	// This is an admin panel, never meant to be crawled or indexed — the
	// header works independently of both the SPA's <meta robots> tag
	// (which a crawler only sees after fetching the page) and robots.txt
	// (which a crawler could ignore outright), and it covers every
	// response including the JSON API, which neither of those touch.
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
		authorized.PUT("/profiles/:id", s.updateProfile)
		authorized.DELETE("/profiles/:id", s.deleteProfile)
		authorized.GET("/profiles/:id/logs", s.getProfileLogs)
		authorized.POST("/profiles/:id/restart", s.restartProfile)
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
		// job status is keyed by kernel name (not a job id) so the frontend
		// can ask "what's happening with turnable/freeturn/xray/olcrtc" after
		// a reload without having remembered anything — see getKernelJob.
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
		authorized.POST("/keygen/short-id", s.keygenShortID)

		authorized.GET("/xray/status", s.getXrayStatus)
		authorized.GET("/xray/logs", s.getXrayLogs)

		authorized.GET("/system/stats", s.getSystemStats)

		authorized.GET("/account", s.getAccount)
		authorized.PUT("/account/password", s.changePassword)
		authorized.GET("/settings", s.getSettings)
		authorized.GET("/settings/panel", s.getPanelSettings)
		authorized.PUT("/settings/panel", s.updatePanelSettings)
		authorized.POST("/settings/panel/restart", s.restartPanel)
		authorized.GET("/settings/panel/update-check", s.checkPanelUpdate)
		authorized.POST("/settings/panel/update", s.updatePanel)
	}

	serveWebUI(r, basePath)

	return r
}

// serveWebUI serves the embedded frontend build (see internal/webui) for
// every request that isn't one of the API/subscription routes above — a
// production deployment is a single binary, no separate frontend host.
// Anything under /api or /sub that didn't match a registered route above
// stays a real 404 rather than falling through to index.html; every other
// unmatched path is assumed to be client-side (react-router-dom) routing
// and gets index.html so a hard refresh on e.g. /xray still works.
//
// index.html gets one fixed byte-level edit at startup: a
// window.__WTP_BASE_PATH__ assignment injected right after <head>. Every
// route in this handler runs already-stripped of the base path (main.go's
// http.StripPrefix happens in front of this whole gin.Engine), so the SPA
// itself is the only thing that can know it — react-router's
// BrowserRouter basename and every fetch() in lib/api.ts read this global
// to prepend the real prefix back on. Without it, a non-"/" base path
// would serve the page fine but break every client-side navigation and API
// call the moment the page runs, since root-absolute paths like
// "/api/login" resolve at the real domain root, not under the prefix.
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
